import neo4j from "neo4j-driver";

let driver; // reuse between invocations (best effort)

function getDriver() {
    if (driver) return driver;

    const uri = process.env.NEO4J_URI || "neo4j+s://1823157a.databases.neo4j.io";
    const user = process.env.NEO4J_USER || "neo4j";
    const password = process.env.NEO4J_PASSWORD;

    if (!password) {
        throw new Error("Missing env var NEO4J_PASSWORD");
    }

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        connectionAcquisitionTimeout: 10_000,
        maxConnectionLifetime: 60 * 60 * 1000,
    });

    return driver;
}

export default async function handler(req, res) {
    // CORS (optional, but nice for browser testing)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (req.method === "OPTIONS") return res.status(200).json({ ok: true });
    if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

    // Optional: protect the endpoint
    const proxyToken = process.env.PROXY_TOKEN;
    if (proxyToken) {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (token !== proxyToken) {
            return res.status(401).json({ error: "Unauthorized" });
        }
    }

    // Accept both keys for now to avoid confusion: cypher OR query
    const { cypher, query, params, mode } = req.body || {};
    const statement = (typeof cypher === "string" && cypher.trim()) ? cypher.trim()
        : (typeof query === "string" && query.trim()) ? query.trim()
            : "";

    if (!statement) {
        return res.status(400).json({ error: "Missing 'cypher' (or 'query') string in JSON body" });
    }

    const started = Date.now();
    const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });

    try {
        const runStatement = mode === "PROFILE" ? `PROFILE ${statement}` : statement;

        const result = await session.run(runStatement, params || {});
        const summary = result.summary;

        const rows = result.records.map((record) => record.toObject());

        return res.status(200).json({
            ok: true,
            queryText: runStatement,
            params: params || {},
            rowCount: rows.length,
            rows,
            neo4j: {
                resultAvailableAfterMs: toNum(summary.resultAvailableAfter),
                resultConsumedAfterMs: toNum(summary.resultConsumedAfter),
                database: summary.database?.name ?? null,
            },
            proxyElapsedMs: Date.now() - started,
        });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            error: error.message,
            proxyElapsedMs: Date.now() - started,
        });
    } finally {
        await session.close();
        // driver NICHT schließen (wichtig bei Serverless)
    }
}

function toNum(v) {
    // neo4j ints can be objects; normalize best effort
    try {
        return typeof v?.toNumber === "function" ? v.toNumber() : v;
    } catch {
        return v;
    }
}

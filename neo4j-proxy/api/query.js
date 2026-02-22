import neo4j from "neo4j-driver";

export default async function handler(req, res) {

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Only POST allowed" });
    }

    const { query, params } = req.body;

    const driver = neo4j.driver(
        "neo4j+s://1823157a.databases.neo4j.io",
        neo4j.auth.basic("neo4j", process.env.NEO4J_PASSWORD)
    );

    const session = driver.session();

    try {
        const result = await session.run(query, params || {});

        const records = result.records.map(record => record.toObject());

        return res.status(200).json(records);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    } finally {
        await session.close();
        await driver.close();
    }
}
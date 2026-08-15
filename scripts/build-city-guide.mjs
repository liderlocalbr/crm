import fs from "node:fs";

const source = JSON.parse(fs.readFileSync("/tmp/ibge-populacao-2025.json", "utf8"));
const rows = source.slice(1).filter((row) => row && row.D1N && row.V);
const cities = rows
  .map((row) => {
    const match = row.D1N.match(/^(.*) - ([A-Z]{2})$/);
    if (!match) return null;
    return {
      ibgeCode: row.D1C,
      name: match[1].trim(),
      state: match[2],
      population: Number(row.V),
      year: Number(row.D2C),
    };
  })
  .filter((city) => city && city.population > 70000)
  .sort((a, b) => b.population - a.population || a.name.localeCompare(b.name, "pt-BR"));

const grouped = Object.fromEntries(
  [...new Set(cities.map((city) => city.state))]
    .sort()
    .map((state) => [state, cities.filter((city) => city.state === state)])
);

fs.writeFileSync("data/cities-by-state.json", JSON.stringify({ source: "IBGE SIDRA tabela 6579", year: 2025, threshold: 70000, states: grouped }, null, 2) + "\n");
console.log(JSON.stringify({ total: cities.length, states: Object.keys(grouped).length, year: 2025 }));

const sparql = `
SELECT ?game ?gameLabel ?slug ?numericId ?pointInTime WHERE {
  ?game p:P166 ?awardStmt .
  ?awardStmt ps:P166 wd:Q78762377 . # The Game Awards − Game of the Year
  OPTIONAL { ?game wdt:P5794 ?slug . }
  OPTIONAL { ?game p:P5794/pq:P9043 ?numericId . }
  OPTIONAL { ?awardStmt pq:P585 ?pointInTime . }
  ?game rdfs:label ?gameLabel .
  FILTER(LANG(?gameLabel) = "en")
}
ORDER BY DESC(?pointInTime)
`;

fetch('https://query.wikidata.org/sparql', {
  method: 'POST',
  headers: {
    'Accept': 'application/sparql-results+json',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'MoctaleAgent/1.0'
  },
  body: `query=${encodeURIComponent(sparql)}`
}).then(async r => {
  const data = await r.json();
  console.log("Total winners:", data.results.bindings.length);
  console.log("Sample winners:", JSON.stringify(data.results.bindings.slice(0, 5), null, 2));
}).catch(console.error);

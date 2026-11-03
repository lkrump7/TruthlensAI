// BDD helper: Given-When-Then scenario wrappers over the existing node:test
// route-import pattern. No new framework; scenario names carry the GWT text.
export const jsonReq = (url, body, headers = {}) => new Request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

// Runs one scenario step set. The Given/When/Then strings are the spec; `act`
// performs the When and asserts the Then. A failing assert fails the scenario.
export async function givenWhenThen(given, when, then, act) {
  if (!given || !when || !then) throw new Error('scenario needs Given, When, and Then');
  await act();
}

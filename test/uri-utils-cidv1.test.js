import { normalizeTokenURI } from "../frontend/src/js/blockchain/uri-utils.js";

const CIDV1 = "bafkreid7qoywk77r7rj3slobqfekdvs57qwuwh5d2z3sqsw52iabe3mqne";

describe("normalizeTokenURI - CIDv1", () => {
  it("returns a bare CIDv1 unchanged", () => {
    expect(normalizeTokenURI(CIDV1)).toBe(CIDV1);
  });
  it("strips ipfs:// from a CIDv1", () => {
    expect(normalizeTokenURI(`ipfs://${CIDV1}`)).toBe(CIDV1);
  });
  it("extracts a CIDv1 from a gateway path", () => {
    expect(normalizeTokenURI(`https://gw.mypinata.cloud/ipfs/${CIDV1}`)).toBe(CIDV1);
  });
});

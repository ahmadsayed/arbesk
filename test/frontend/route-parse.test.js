/**
 * @jest-environment jsdom
 */
import { describe, expect, test } from "@jest/globals";
import { parseAppPath } from "../../frontend/src/js/app/route-parse.js";

const ADDRESS = "0xccc626354a2ea985d4abdc1173597a46afc63595";
const BASE58 = "3rTyYaQADATmQkvr5vkTteihpSHz";

describe("parseAppPath", () => {
  test("root and unknown paths resolve to studio with no subject", () => {
    for (const path of ["/", "/anything-else", "/foo/bar"]) {
      expect(parseAppPath(path)).toEqual({
        view: "studio",
        subjectAddress: null,
        invalidSubject: false,
      });
    }
  });

  test("bare view paths carry no subject", () => {
    expect(parseAppPath("/studio")).toEqual({
      view: "studio",
      subjectAddress: null,
      invalidSubject: false,
    });
    expect(parseAppPath("/library")).toEqual({
      view: "library",
      subjectAddress: null,
      invalidSubject: false,
    });
  });

  test("/library/<base58> decodes the profile subject", () => {
    expect(parseAppPath(`/library/${BASE58}`)).toEqual({
      view: "library",
      subjectAddress: ADDRESS,
      invalidSubject: false,
    });
  });

  test("/studio/<base58> parses the subject for future use", () => {
    expect(parseAppPath(`/studio/${BASE58}`)).toEqual({
      view: "studio",
      subjectAddress: ADDRESS,
      invalidSubject: false,
    });
  });

  test("invalid base58 segment flags invalidSubject with no address", () => {
    expect(parseAppPath("/library/not-valid-base58!!!")).toEqual({
      view: "library",
      subjectAddress: null,
      invalidSubject: true,
    });
    expect(parseAppPath("/library/1")).toEqual({
      view: "library",
      subjectAddress: null,
      invalidSubject: true,
    });
  });

  test("trailing slash after the subject is tolerated", () => {
    expect(parseAppPath(`/library/${BASE58}/`)).toEqual({
      view: "library",
      subjectAddress: ADDRESS,
      invalidSubject: false,
    });
  });
});

import { TextDecoder, TextEncoder } from "util";

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this);
    });
  };
}

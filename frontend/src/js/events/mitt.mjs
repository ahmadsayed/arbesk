/**
 * Tiny event emitter.
 *
 * @param {Map<string, Array<(...args: any[]) => void>>} [all]
 * @returns {{
 *   all: Map<string, Array<(...args: any[]) => void>>,
 *   on: (type: string, handler: (...args: any[]) => void) => void,
 *   off: (type: string, handler?: (...args: any[]) => void) => void,
 *   emit: (type: string, data?: any) => void
 * }}
 */
export default function (all) {
  all = all || new Map();
  return {
    all: all,
    on: function (type, handler) {
      var list = all.get(type);
      if (list) {
        list.push(handler);
      } else {
        all.set(type, [handler]);
      }
    },
    off: function (type, handler) {
      var list = all.get(type);
      if (!list) return;
      if (handler) {
        list.splice(list.indexOf(handler) >>> 0, 1);
      } else {
        all.set(type, []);
      }
    },
    emit: function (type, data) {
      var list = all.get(type);
      if (list) {
        list.slice().map(function (handler) {
          handler(data);
        });
      }
      var wild = all.get("*");
      if (wild) {
        wild.slice().map(function (handler) {
          handler(type, data);
        });
      }
    },
  };
}

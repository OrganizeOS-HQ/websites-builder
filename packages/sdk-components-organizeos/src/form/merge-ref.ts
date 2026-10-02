import {
  useCallback,
  type ForwardedRef,
  type MutableRefObject,
  type RefCallback,
} from "react";

/**
 * One ref callback for the ref a part receives (the canvas passes one) and
 * the part's own ref to its element.
 */
export const useMergedRef = <Value>(
  forwardedRef: ForwardedRef<Value>,
  ownRef: MutableRefObject<Value | null>
): RefCallback<Value> =>
  useCallback(
    (value: Value | null) => {
      ownRef.current = value;
      if (typeof forwardedRef === "function") {
        forwardedRef(value);
      } else if (forwardedRef) {
        forwardedRef.current = value;
      }
    },
    [forwardedRef, ownRef]
  );

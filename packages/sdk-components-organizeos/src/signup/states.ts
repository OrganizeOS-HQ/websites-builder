/**
 * The Signup Form's states. Its `state` prop and `onStateChange` action use
 * these names, and the template's state boxes show on them.
 */
export const signupFormStates = [
  "initial",
  "submitting",
  "success",
  "confirm-email",
  "error",
  "unavailable",
] as const;

export type SignupFormState = (typeof signupFormStates)[number];

/** The endpoint the Signup Form posts to, on the page's own origin. */
export const signupsPath = "/api/public/site/v1/signups";

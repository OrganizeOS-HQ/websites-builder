/**
 * `ReactSdkContext.renderer`: "canvas" and "preview" are the builder, which
 * runs on the builder's origin; undefined is a published site.
 */
export type Renderer = "canvas" | "preview" | undefined;

/** The builder never submits: a block there shows its states and never posts. */
export const isBuilderRender = (renderer: Renderer) =>
  renderer === "canvas" || renderer === "preview";

/**
 * What a platform endpoint answered: `{ outcome }` on success, `{ error,
 * field? }` on failure. A network failure or an answer this build cannot read
 * is an error too.
 */
export type PlatformAnswer =
  | { outcome: string }
  | { error: string; field?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const readAnswer = async (response: Response): Promise<PlatformAnswer> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (isRecord(payload)) {
    if (response.ok && typeof payload.outcome === "string") {
      return { outcome: payload.outcome };
    }
    if (typeof payload.error === "string") {
      return typeof payload.field === "string"
        ? { error: payload.error, field: payload.field }
        : { error: payload.error };
    }
  }
  return { error: "unreadable_answer" };
};

/**
 * Posts a JSON body to a platform endpoint on the page's own origin. Every
 * org host reserves `/api` for OrganizeOS, so the request reaches the
 * platform, never the published site.
 *
 * Returns undefined, without posting, on the builder's canvas and preview.
 * Never throws: a failure comes back as an error answer.
 */
export const postToPlatform = async ({
  renderer,
  path,
  body,
}: {
  renderer: Renderer;
  path: string;
  body: unknown;
}): Promise<PlatformAnswer | undefined> => {
  if (isBuilderRender(renderer)) {
    return;
  }
  // Same origin only: an absolute path, never a URL or a protocol-relative one.
  if (path.startsWith("/") === false || path.startsWith("//")) {
    return { error: "invalid_path" };
  }
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return await readAnswer(response);
  } catch {
    return { error: "network" };
  }
};

/** How a family turns answers into its states. */
export type AnswerStates<State extends string> = {
  /** The outcomes this build knows, and the state each one shows. */
  outcomes: Readonly<Record<string, State>>;
  /** The family's success state, for an outcome this build does not know. */
  success: State;
  /** The family's error state, for every error, known or not. */
  error: State;
};

/**
 * Maps an answer to a state. A published site freezes this code, so an
 * outcome the platform adds later lands in the family's success state and an
 * error it adds later in its error state. `field` names the field an
 * `invalid_field` error is about.
 */
export const stateForAnswer = <State extends string>(
  answer: PlatformAnswer,
  states: AnswerStates<State>
): { state: State; field?: string } => {
  if ("outcome" in answer) {
    const known = Object.hasOwn(states.outcomes, answer.outcome)
      ? states.outcomes[answer.outcome]
      : undefined;
    return { state: known ?? states.success };
  }
  if (answer.error === "invalid_field" && answer.field !== undefined) {
    return { state: states.error, field: answer.field };
  }
  return { state: states.error };
};

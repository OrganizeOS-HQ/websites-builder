/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReactSdkContext } from "@webstudio-is/react-sdk/runtime";
import forms from "../__fixtures__/forms.json";
import requestCheckbox from "../__fixtures__/signups/request-checkbox.json";
import requestContactForm from "../__fixtures__/signups/request-contact-form.json";
import requestForm from "../__fixtures__/signups/request-form.json";
import requestOrgDefaults from "../__fixtures__/signups/request-org-defaults.json";
import responseConfirmEmail from "../__fixtures__/signups/response-confirm-email.json";
import responseInvalidField from "../__fixtures__/signups/response-invalid-field.json";
import responseInvalidRequest from "../__fixtures__/signups/response-invalid-request.json";
import responseNotFound from "../__fixtures__/signups/response-not-found.json";
import responseRateLimited from "../__fixtures__/signups/response-rate-limited.json";
import responseReceived from "../__fixtures__/signups/response-received.json";
import responseSubscribed from "../__fixtures__/signups/response-subscribed.json";
import responseUnavailable from "../__fixtures__/signups/response-unavailable.json";
import { navigateTo } from "../form/navigate";
import type { Renderer } from "../form/submit";
import { Field, FieldInput, FieldLabel, FieldMessage } from "./field";
import { SignupForm } from "./signup-form";
import type { SignupFormState } from "./states";
import { SubmitButton } from "./submit-button";

vi.mock("../form/navigate", () => ({ navigateTo: vi.fn(() => true) }));

const newsletterId = requestForm.form_id;
const contactFormId = requestContactForm.form_id;
const membershipFormId = "c4e8a1f2-7d3b-4a96-b5e0-9f1d2c6a8b47";
const missingFormId = "00000000-0000-4000-8000-000000000000";

const Sdk = ({
  renderer,
  children,
}: {
  renderer: Renderer;
  children: ReactNode;
}) => (
  <ReactSdkContext.Provider
    value={{
      assetBaseUrl: "/",
      imageLoader: ({ src }) => src,
      resources: {},
      breakpoints: [],
      onError: () => {},
      renderer,
    }}
  >
    {children}
  </ReactSdkContext.Provider>
);

/** One Field with its three parts, labelled with the designer's text. */
const TestField = ({
  name,
  label,
  hint,
}: {
  name: string;
  label: string;
  hint?: string;
}) => (
  <Field field={name}>
    <FieldLabel>{label}</FieldLabel>
    <FieldInput />
    <FieldMessage>{hint}</FieldMessage>
  </Field>
);

type BlockOptions = {
  renderer?: Renderer;
  record?: string;
  data?: unknown;
  state?: SignupFormState;
  action?: "state" | "page";
  actionPage?: string;
  onStateChange?: (state: SignupFormState, message: string) => void;
  fields?: Array<[name: string, label: string]>;
  submit?: boolean;
};

const Block = (options: BlockOptions) => {
  const {
    renderer,
    record,
    state,
    action,
    actionPage,
    onStateChange,
    fields = [
      ["email", "Email"],
      ["first_name", "First name"],
    ],
    submit = true,
  } = options;
  // the Forms fixture unless a test passes data, undefined included
  const data = "data" in options ? options.data : forms;
  return (
    <Sdk renderer={renderer}>
      <SignupForm
        record={record}
        data={data}
        state={state}
        action={action}
        actionPage={actionPage}
        onStateChange={onStateChange}
      >
        {fields.map(([name, label]) => (
          <TestField key={name} name={name} label={label} />
        ))}
        {submit && <SubmitButton>Sign up</SubmitButton>}
      </SignupForm>
    </Sdk>
  );
};

const getForm = (container: HTMLElement) => {
  const form = container.querySelector("form");
  if (form === null) {
    throw new Error("no form rendered");
  }
  return form;
};

const getCanvasCheck = (container: HTMLElement) =>
  container.querySelector("[data-organizeos-canvas-check]");

const fill = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

type ResponseFixture = { status: number; body: unknown };

const stubFetch = (respond: () => Promise<Response>) => {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    respond()
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const answerWith = (fixture: ResponseFixture) =>
  stubFetch(async () =>
    Response.json(fixture.body, { status: fixture.status })
  );

/** The parsed body of the one request sent, after checking how it was sent. */
const sentBody = (fetchMock: ReturnType<typeof stubFetch>) => {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [input, init] = fetchMock.mock.calls[0];
  expect(input).toBe("/api/public/site/v1/signups");
  expect(init?.method).toBe("POST");
  expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  expect(init?.credentials).toBe("same-origin");
  return JSON.parse(String(init?.body));
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(navigateTo).mockClear();
});

describe("parts", () => {
  test("register with their root: the canvas check follows them as they come and go", () => {
    const { container, rerender } = render(
      <Block renderer="canvas" submit={false} />
    );
    expect(getCanvasCheck(container)?.textContent).toContain(
      "Add a Submit Button."
    );
    rerender(<Block renderer="canvas" />);
    expect(getCanvasCheck(container)).toBeNull();
    rerender(
      <Block renderer="canvas" fields={[["first_name", "First name"]]} />
    );
    expect(getCanvasCheck(container)?.textContent).toContain(
      "Add a Field for email"
    );
  });

  test("a Field wires its label, input and message together", () => {
    render(
      <Sdk renderer={undefined}>
        <SignupForm data={forms}>
          <TestField name="email" label="Email" hint="We never share it." />
        </SignupForm>
      </Sdk>
    );
    const input = screen.getByLabelText("Email");
    const message = screen.getByText("We never share it.");
    expect(input.getAttribute("name")).toBe("email");
    expect(input.getAttribute("type")).toBe("email");
    expect(input.getAttribute("autocomplete")).toBe("email");
    expect(input.hasAttribute("required")).toBe(true);
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("data-invalid")).toBe(false);
  });

  test("a Field Input renders the element its field's type calls for", () => {
    render(
      <Sdk renderer={undefined}>
        <SignupForm record={contactFormId} data={forms}>
          <TestField name="name" label="Name" />
          <TestField name="topic" label="Topic" />
          <TestField name="message" label="Message" />
        </SignupForm>
        <SignupForm record={newsletterId} data={forms}>
          <TestField name="first_name" label="First name" />
          <TestField name="volunteer_interest" label="I want to volunteer" />
        </SignupForm>
        <SignupForm data={forms}>
          <TestField name="phone" label="Phone" />
        </SignupForm>
      </Sdk>
    );
    const name = screen.getByLabelText("Name");
    expect(name.getAttribute("type")).toBe("text");
    expect(name.getAttribute("autocomplete")).toBe("name");
    expect(name.hasAttribute("required")).toBe(true);
    const topic = screen.getByLabelText("Topic");
    expect(topic.tagName).toBe("SELECT");
    expect(topic.hasAttribute("required")).toBe(false);
    expect(
      Array.from(topic.querySelectorAll("option"), (option) => option.value)
    ).toEqual(["", "Press", "Volunteering", "Other"]);
    expect(screen.getByLabelText("Message").tagName).toBe("TEXTAREA");
    expect(
      screen.getByLabelText("First name").getAttribute("autocomplete")
    ).toBe("given-name");
    expect(
      screen.getByLabelText("I want to volunteer").getAttribute("type")
    ).toBe("checkbox");
    const phone = screen.getByLabelText("Phone");
    expect(phone.getAttribute("type")).toBe("tel");
    expect(phone.getAttribute("autocomplete")).toBe("tel");
  });

  test("the root renders a native-validating form with a hidden honeypot outside the designer's content", () => {
    const { container } = render(<Block />);
    const form = getForm(container);
    expect(form.hasAttribute("novalidate")).toBe(false);
    expect(form.getAttribute("method")).toBe("post");
    const honeypot = form.lastElementChild;
    expect(honeypot?.getAttribute("name")).toBe("website");
    expect(honeypot?.getAttribute("tabindex")).toBe("-1");
    expect(honeypot?.getAttribute("autocomplete")).toBe("off");
    expect(honeypot?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("request body", () => {
  test("a form's fields match request-form.json", async () => {
    window.history.replaceState(null, "", "/get-involved");
    const fetchMock = answerWith(responseSubscribed);
    const { container } = render(
      <Block
        record={newsletterId}
        fields={[
          ["email", "Email"],
          ["first_name", "First name"],
          ["last_name", "Last name"],
        ]}
      />
    );
    fill("Email", "ada@example.org");
    fill("First name", "Ada");
    fill("Last name", "Lovelace");
    fireEvent.submit(getForm(container));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual(requestForm);
  });

  test("the org defaults match request-org-defaults.json, with no form_id", async () => {
    const fetchMock = answerWith(responseSubscribed);
    const { container } = render(<Block />);
    fill("Email", "ada@example.org");
    fill("First name", "Ada");
    fireEvent.submit(getForm(container));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = sentBody(fetchMock);
    expect(body).toEqual(requestOrgDefaults);
    expect("form_id" in body).toBe(false);
  });

  test('checkboxes match request-checkbox.json: "true" when checked, "" when not', async () => {
    window.history.replaceState(null, "", "/get-involved");
    const fetchMock = answerWith(responseSubscribed);
    const { container } = render(
      <Block
        record={newsletterId}
        fields={[
          ["email", "Email"],
          ["volunteer_interest", "I want to volunteer"],
          ["newsletter_weekly", "Send me the weekly roundup"],
        ]}
      />
    );
    fill("Email", "ada@example.org");
    fireEvent.click(screen.getByLabelText("I want to volunteer"));
    fireEvent.submit(getForm(container));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual(requestCheckbox);
  });

  test("a contact form, with a textarea, matches request-contact-form.json", async () => {
    window.history.replaceState(null, "", "/contact");
    const fetchMock = answerWith(responseReceived);
    const { container } = render(
      <Block
        record={contactFormId}
        fields={[
          ["name", "Name"],
          ["email", "Email"],
          ["message", "Message"],
        ]}
      />
    );
    fill("Name", "Ada Lovelace");
    fill("Email", "ada@example.org");
    fill("Message", "Can we table at your next meeting?");
    fireEvent.submit(getForm(container));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual(requestContactForm);
  });

  test("sends the honeypot's value, and nothing a Field names that the form lacks", async () => {
    const fetchMock = answerWith(responseSubscribed);
    const { container } = render(
      <Block
        fields={[
          ["email", "Email"],
          ["favorite_color", "Favorite color"],
        ]}
      />
    );
    fill("Email", "ada@example.org");
    fill("Favorite color", "green");
    const honeypot = getForm(container).querySelector('[name="website"]');
    if (honeypot === null) {
      throw new Error("no honeypot");
    }
    fireEvent.change(honeypot, { target: { value: "https://spam.example" } });
    fireEvent.submit(getForm(container));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({
      fields: { email: "ada@example.org" },
      page_path: "/",
      website: "https://spam.example",
    });
  });
});

describe("states", () => {
  const submitWith = async (
    fixture: ResponseFixture,
    options?: BlockOptions
  ) => {
    const fetchMock = answerWith(fixture);
    const onStateChange = vi.fn();
    const view = render(<Block {...options} onStateChange={onStateChange} />);
    fill("Email", "ada@example.org");
    fireEvent.submit(getForm(view.container));
    await waitFor(() => expect(onStateChange).toHaveBeenCalledTimes(2));
    expect(onStateChange.mock.calls[0]).toEqual(["submitting", ""]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return { ...view, onStateChange };
  };

  test.each([
    ["subscribed", "success", responseSubscribed],
    ["received", "success", responseReceived],
    ["confirm_email", "confirm-email", responseConfirmEmail],
    ["invalid_field", "error", responseInvalidField],
    ["invalid_request", "error", responseInvalidRequest],
    ["not_found", "error", responseNotFound],
    ["rate_limited", "error", responseRateLimited],
    ["unavailable", "error", responseUnavailable],
  ])("%s lands in %s", async (code, expected, fixture) => {
    const { container, onStateChange } = await submitWith(fixture);
    const [state, message] = onStateChange.mock.calls[1];
    expect(state).toBe(expected);
    // the platform's words never reach the visitor
    expect(message).not.toContain(code);
    expect(container.textContent).not.toContain(code);
  });

  test("an outcome this build does not know lands in success", async () => {
    const { onStateChange } = await submitWith({
      status: 200,
      body: { outcome: "added_to_waitlist" },
    });
    expect(onStateChange.mock.calls[1][0]).toBe("success");
  });

  test("an error this build does not know lands in error", async () => {
    const { onStateChange } = await submitWith({
      status: 418,
      body: { error: "teapot" },
    });
    expect(onStateChange.mock.calls[1][0]).toBe("error");
  });

  test("an answer that is not JSON, or a network failure, lands in error", async () => {
    stubFetch(
      async () => new Response("<html>Not found</html>", { status: 404 })
    );
    const onStateChange = vi.fn();
    const { container } = render(<Block onStateChange={onStateChange} />);
    fill("Email", "ada@example.org");
    fireEvent.submit(getForm(container));
    await waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith(
        "error",
        expect.any(String)
      )
    );
    cleanup();

    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const onStateChangeOffline = vi.fn();
    const offline = render(<Block onStateChange={onStateChangeOffline} />);
    fill("Email", "ada@example.org");
    fireEvent.submit(getForm(offline.container));
    await waitFor(() =>
      expect(onStateChangeOffline).toHaveBeenLastCalledWith(
        "error",
        expect.any(String)
      )
    );
  });

  test("invalid_field shows a generic message in that field's Field Message", async () => {
    await submitWith(responseInvalidField);
    const email = screen.getByLabelText("Email");
    const firstName = screen.getByLabelText("First name");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.hasAttribute("data-invalid")).toBe(true);
    expect(firstName.hasAttribute("aria-invalid")).toBe(false);
    const messageId = email.getAttribute("aria-describedby") ?? "";
    const message = document.getElementById(messageId);
    expect(message?.textContent).toBe("Enter a valid email address.");
    expect(message?.hasAttribute("data-invalid")).toBe(true);
  });

  test("the Submit Button is disabled with data-state while submitting", async () => {
    let answer: (response: Response) => void = () => {};
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        })
    );
    const onStateChange = vi.fn();
    const { container } = render(<Block onStateChange={onStateChange} />);
    fill("Email", "ada@example.org");
    const button = screen.getByRole("button", { name: "Sign up" });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.submit(getForm(container));
    await waitFor(() =>
      expect(button.getAttribute("data-state")).toBe("submitting")
    );
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(onStateChange).toHaveBeenLastCalledWith("submitting", "");
    // a second submit while one is pending sends nothing
    fireEvent.submit(getForm(container));
    answer(Response.json(responseSubscribed.body));
    await waitFor(() =>
      expect(onStateChange).toHaveBeenLastCalledWith(
        "success",
        expect.any(String)
      )
    );
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.hasAttribute("data-state")).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  test("with action page, success goes to the page", async () => {
    await submitWith(responseSubscribed, {
      action: "page",
      actionPage: "/thanks",
    });
    expect(navigateTo).toHaveBeenCalledWith("/thanks");
  });

  test("with action page, check-your-email stays on the state", async () => {
    await submitWith(responseConfirmEmail, {
      action: "page",
      actionPage: "/thanks",
    });
    expect(navigateTo).not.toHaveBeenCalled();
  });

  test("with action state, success stays on the state", async () => {
    await submitWith(responseSubscribed, { actionPage: "/thanks" });
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe("the builder never posts", () => {
  test.each(["canvas", "preview"] as const)(
    "no fetch on the %s",
    async (renderer) => {
      const fetchMock = answerWith(responseSubscribed);
      const onStateChange = vi.fn();
      const { container } = render(
        <Block renderer={renderer} onStateChange={onStateChange} />
      );
      fill("Email", "ada@example.org");
      fireEvent.submit(getForm(container));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onStateChange).not.toHaveBeenCalled();
    }
  );
});

describe("unavailable", () => {
  test.each([
    ["the record is missing from data", { record: missingFormId }],
    ["the record is a membership form", { record: membershipFormId }],
    ["data is missing", { data: undefined }],
    ["data is malformed", { data: { data: "forms" } }],
    [
      "a record is set and data is missing",
      { record: newsletterId, data: null },
    ],
  ])(
    "when %s: reported on a published site, and nothing posts",
    async (_case, options) => {
      const fetchMock = answerWith(responseSubscribed);
      const onStateChange = vi.fn();
      const { container } = render(
        <Block {...options} onStateChange={onStateChange} />
      );
      await waitFor(() =>
        expect(onStateChange).toHaveBeenCalledWith(
          "unavailable",
          expect.any(String)
        )
      );
      fireEvent.submit(getForm(container));
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  test("the canvas warns instead, and never reports", () => {
    const onStateChange = vi.fn();
    const { container } = render(
      <Block
        renderer="canvas"
        record={missingFormId}
        onStateChange={onStateChange}
      />
    );
    expect(getCanvasCheck(container)?.textContent).toContain(
      "Its form is not available"
    );
    expect(onStateChange).not.toHaveBeenCalled();
  });

  test("missing data warns on the canvas", () => {
    const { container } = render(<Block renderer="canvas" data={undefined} />);
    expect(getCanvasCheck(container)?.textContent).toContain(
      "Forms data is missing"
    );
  });
});

describe("canvas check", () => {
  test("a complete block draws nothing", () => {
    const { container } = render(<Block renderer="canvas" />);
    expect(getCanvasCheck(container)).toBeNull();
  });

  test("no Field for email, when the defaults require it", () => {
    const { container } = render(
      <Block renderer="canvas" fields={[["first_name", "First name"]]} />
    );
    expect(getCanvasCheck(container)?.textContent).toContain(
      "Add a Field for email: the form requires it."
    );
  });

  test("no Submit Button", () => {
    const { container } = render(<Block renderer="canvas" submit={false} />);
    expect(getCanvasCheck(container)?.textContent).toContain(
      "Add a Submit Button."
    );
  });

  test("a required form field with no Field", () => {
    const { container } = render(
      <Block
        renderer="canvas"
        record={contactFormId}
        fields={[["email", "Email"]]}
      />
    );
    const text = getCanvasCheck(container)?.textContent ?? "";
    expect(text).toContain('Add a Field for "Name" (name)');
    expect(text).toContain('Add a Field for "Message" (message)');
    expect(text).not.toContain("Add a Field for email");
    // the optional select is not required
    expect(text).not.toContain("topic");
  });

  test("a Field naming a field the form does not have", () => {
    const { container } = render(
      <Block
        renderer="canvas"
        fields={[
          ["email", "Email"],
          ["favorite_color", "Favorite color"],
          ["", "Nothing"],
        ]}
      />
    );
    const text = getCanvasCheck(container)?.textContent ?? "";
    expect(text).toContain(
      'A Field is set to "favorite_color", which its form does not have.'
    );
    expect(text).toContain("A Field has no form field.");
  });

  test("a root inside another Signup Form", () => {
    // React reports the invalid nesting itself; the check is what the designer sees
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { container } = render(
      <Sdk renderer="canvas">
        <SignupForm data={forms}>
          <TestField name="email" label="Outer email" />
          <SubmitButton>Outer</SubmitButton>
          <SignupForm data={forms}>
            <TestField name="email" label="Inner email" />
            <SubmitButton>Inner</SubmitButton>
          </SignupForm>
        </SignupForm>
      </Sdk>
    );
    const checks = container.querySelectorAll("[data-organizeos-canvas-check]");
    expect(checks).toHaveLength(1);
    expect(checks[0].textContent).toContain(
      "It sits inside another OrganizeOS form."
    );
    consoleError.mockRestore();
  });

  test("a root inside a native form", () => {
    // React reports the invalid nesting itself; the check is what the designer sees
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { container } = render(
      <form>
        <Block renderer="canvas" />
      </form>
    );
    expect(getCanvasCheck(container)?.textContent).toContain(
      "It sits inside a Form."
    );
    consoleError.mockRestore();
  });

  test("states that hide the form's content do not report its parts", () => {
    const { container } = render(
      <Block renderer="canvas" state="success" fields={[]} submit={false} />
    );
    expect(getCanvasCheck(container)).toBeNull();
  });

  test("nothing renders on a published site or in the preview", () => {
    for (const renderer of [undefined, "preview"] as const) {
      const { container } = render(
        <Block
          renderer={renderer}
          fields={[["favorite_color", "Favorite color"]]}
          submit={false}
        />
      );
      expect(getCanvasCheck(container)).toBeNull();
      cleanup();
    }
  });

  test("the design-time submitting state styles the Submit Button but keeps it selectable", () => {
    render(<Block renderer="canvas" state="submitting" />);
    const button = screen.getByRole("button", { name: "Sign up" });
    expect(button.getAttribute("data-state")).toBe("submitting");
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});

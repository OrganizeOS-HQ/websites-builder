import {
  ws,
  ActionValue,
  css,
  expression,
  PlaceholderValue,
  token,
  Variable,
  type TemplateMeta,
} from "@webstudio-is/template";
import { organizeos } from "./shared/proxy";

// Neutral styles through shared tokens: every OrganizeOS block uses the same
// four, so restyling a token restyles every block on the site.

const fieldToken = token(
  "OS Field",
  css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `
);

const inputToken = token(
  "OS Input",
  css`
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #d4d4d8;
    border-radius: 6px;
    background-color: #ffffff;
    color: #18181b;
    font-size: 16px;
    line-height: 1.5;
    &:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 1px;
    }
    &[data-invalid] {
      border-color: #dc2626;
    }
  `
);

const buttonToken = token(
  "OS Button",
  css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 16px;
    border: 0;
    border-radius: 6px;
    background-color: #18181b;
    color: #ffffff;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.5;
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    &[data-state="submitting"] {
      opacity: 0.6;
      cursor: progress;
    }
  `
);

const messageToken = token(
  "OS Message",
  css`
    font-size: 14px;
    line-height: 1.4;
    color: #52525b;
    &[data-invalid] {
      color: #b91c1c;
    }
  `
);

const formState = new Variable("formState", "initial");

// `data` is left unbound: the OrganizeOS panel binds it to the project's
// Forms preset by id when it inserts the block.
export const meta: TemplateMeta = {
  category: "hidden",
  label: "Signup Form",
  description:
    "Collect newsletter and contact signups into OrganizeOS. Works with the org defaults until you pick one of the organization's forms.",
  template: (
    <organizeos.SignupForm
      state={expression`${formState}`}
      onStateChange={
        new ActionValue(["state"], expression`${formState} = state`)
      }
    >
      <ws.element
        ws:tag="div"
        ws:label="Form Content"
        ws:show={expression`${formState} === 'initial' || ${formState} === 'submitting' || ${formState} === 'error'`}
        ws:style={css`
          display: flex;
          flex-direction: column;
          gap: 16px;
        `}
      >
        <ws.element ws:tag="h2">
          {new PlaceholderValue("Sign up for updates")}
        </ws.element>
        <organizeos.Field
          ws:label="Field: Email"
          field="email"
          ws:tokens={[fieldToken]}
        >
          <organizeos.FieldLabel>
            {new PlaceholderValue("Email")}
          </organizeos.FieldLabel>
          <organizeos.FieldInput ws:tokens={[inputToken]} />
          <organizeos.FieldMessage ws:tokens={[messageToken]} />
        </organizeos.Field>
        <organizeos.Field
          ws:label="Field: First name"
          field="first_name"
          ws:tokens={[fieldToken]}
        >
          <organizeos.FieldLabel>
            {new PlaceholderValue("First name")}
          </organizeos.FieldLabel>
          <organizeos.FieldInput ws:tokens={[inputToken]} />
          <organizeos.FieldMessage ws:tokens={[messageToken]} />
        </organizeos.Field>
        <organizeos.SubmitButton ws:tokens={[buttonToken]}>
          {new PlaceholderValue("Sign up")}
        </organizeos.SubmitButton>
      </ws.element>
      <ws.element
        ws:tag="div"
        ws:label="Success"
        ws:show={expression`${formState} === 'success'`}
      >
        {new PlaceholderValue("Thanks for signing up!")}
      </ws.element>
      <ws.element
        ws:tag="div"
        ws:label="Check your email"
        ws:show={expression`${formState} === 'confirm-email'`}
      >
        {
          new PlaceholderValue(
            "Almost there. Check your email and confirm your address to finish signing up."
          )
        }
      </ws.element>
      <ws.element
        ws:tag="div"
        ws:label="Error"
        ws:show={expression`${formState} === 'error'`}
      >
        {new PlaceholderValue("Something went wrong. Please try again.")}
      </ws.element>
      <ws.element
        ws:tag="div"
        ws:label="Unavailable"
        ws:show={expression`${formState} === 'unavailable'`}
      >
        {new PlaceholderValue("Signups are not available right now.")}
      </ws.element>
    </organizeos.SignupForm>
  ),
};

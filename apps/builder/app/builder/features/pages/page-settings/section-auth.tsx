import { useId, useState } from "react";
import {
  Checkbox,
  CheckboxAndLabel,
  Grid,
  InputErrorsTooltip,
  InputField,
  Label,
  ProBadge,
  Text,
  Tooltip,
  rawTheme,
} from "@webstudio-is/design-system";
import { InfoCircleIcon } from "@webstudio-is/icons";
import { validateBasicAuth } from "@webstudio-is/wsauth";
import type { Errors, OnChange, Values } from "./shared";
import { planUpgradeHint } from "~/shared/branding";

const emptyAuth: Values["auth"] = {
  login: "",
  password: "",
};

export const validateAuthSection = (values: Values): Errors => {
  const hasAuth = values.auth.login !== "" || values.auth.password !== "";
  const authErrors = hasAuth
    ? validateBasicAuth({
        login: values.auth.login,
        password: values.auth.password,
      }).errors
    : undefined;
  if (authErrors === undefined) {
    return {};
  }
  return { auth: authErrors };
};

export const AuthSection = ({
  values,
  errors,
  onChange,
  showUpgrade = false,
  showErrors = false,
}: {
  values: Values;
  errors: Errors;
  onChange: OnChange;
  showUpgrade?: boolean;
  showErrors?: boolean;
}) => {
  const enableId = useId();
  const loginId = useId();
  const passwordId = useId();
  const [isExpanded, setIsExpanded] = useState(
    values.auth.login !== "" || values.auth.password !== ""
  );
  const [touchedFields, setTouchedFields] = useState({
    login: false,
    password: false,
  });
  return (
    <Grid gap={2}>
      <Grid gap={1}>
        <CheckboxAndLabel>
          <Checkbox
            id={enableId}
            checked={isExpanded}
            onCheckedChange={(checked) => {
              const nextIsExpanded = checked === true;
              setIsExpanded(nextIsExpanded);
              if (nextIsExpanded === false) {
                setTouchedFields({ login: false, password: false });
                onChange({
                  field: "auth",
                  value: emptyAuth,
                });
              }
            }}
          />
          <Label htmlFor={enableId}>Require login and password</Label>
          {showUpgrade && <ProBadge>PRO</ProBadge>}
          <Tooltip
            content={
              <>
                <Text>
                  Authentication asks visitors for HTTP Basic Auth credentials
                  before protected pages load on custom domains.
                </Text>
                {showUpgrade && (
                  <>
                    <br />
                    <Text>
                      Page authentication is not included in your plan. You can
                      still publish to staging; publishing to custom domains
                      needs a plan that includes it. {planUpgradeHint}
                    </Text>
                  </>
                )}
              </>
            }
            variant="wrapped"
          >
            <InfoCircleIcon
              color={rawTheme.colors.foregroundSubtle}
              tabIndex={-1}
            />
          </Tooltip>
        </CheckboxAndLabel>
        <Grid gap={1}>
          <Text color="subtle">
            {isExpanded ? (
              <>
                Visitors on <b>custom domains</b> will be asked for HTTP Basic
                Auth credentials before this page loads.
              </>
            ) : (
              "Anyone can access this page right now."
            )}
          </Text>
        </Grid>
      </Grid>

      {isExpanded && (
        <Grid
          gapX={2}
          gapY={2}
          align="center"
          css={{
            gridTemplateColumns: `auto 1fr`,
          }}
        >
          <Label htmlFor={loginId}>Login</Label>
          <InputErrorsTooltip
            errors={
              showErrors || touchedFields.login ? errors.auth?.login : undefined
            }
          >
            <InputField
              color={
                (showErrors || touchedFields.login) && errors.auth?.login
                  ? "error"
                  : undefined
              }
              id={loginId}
              value={values.auth.login}
              onChange={(event) => {
                setTouchedFields((touchedFields) => ({
                  ...touchedFields,
                  login: true,
                }));
                onChange({
                  field: "auth",
                  value: { ...values.auth, login: event.target.value },
                });
              }}
            />
          </InputErrorsTooltip>
          <Label htmlFor={passwordId}>Password</Label>
          <InputErrorsTooltip
            errors={
              showErrors || touchedFields.password
                ? errors.auth?.password
                : undefined
            }
          >
            <InputField
              color={
                (showErrors || touchedFields.password) && errors.auth?.password
                  ? "error"
                  : undefined
              }
              id={passwordId}
              type="password"
              value={values.auth.password}
              onChange={(event) => {
                setTouchedFields((touchedFields) => ({
                  ...touchedFields,
                  password: true,
                }));
                onChange({
                  field: "auth",
                  value: { ...values.auth, password: event.target.value },
                });
              }}
            />
          </InputErrorsTooltip>
        </Grid>
      )}
    </Grid>
  );
};

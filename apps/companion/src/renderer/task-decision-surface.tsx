import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  customerRequestActions,
  customerRequestDescription,
  type CustomerCollaborationRequest,
} from "../main/codex/customer-task-collaboration.js";
import type {
  ProductAttentionDecision,
  ProductAttentionProjection,
  ProductElicitationField,
} from "../main/codex/local-product-api.js";

export type DecisionAnswers = Record<string, string[]>;
export type DecisionForm = Record<string, string | number | boolean | string[]>;

/** Client feedback only; the host validates the provider schema again before dispatch. */
export function decisionValidation(
  entry: ProductAttentionProjection,
  answers: DecisionAnswers,
  form: DecisionForm,
): { id: string; message: string }[] {
  if (entry.kind === "user_input")
    return (entry.questions ?? []).flatMap((question) => {
      const value = answers[question.id]?.[0];
      return !value?.trim() ||
        (question.options &&
          !question.isOther &&
          !question.options.some((option) => option.label === value))
        ? [
            {
              id: question.id,
              message: `Choose or enter an answer for ${question.header}.`,
            },
          ]
        : [];
    });
  return (entry.elicitation?.fields ?? []).flatMap((field) => {
    const value = form[field.id] ?? field.default;
    const missing = value === undefined;
    if (missing)
      return field.required
        ? [{ id: field.id, message: `${field.title} is required.` }]
        : [];
    let invalid = false;
    if (field.type === "number" || field.type === "integer") {
      invalid =
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.type === "integer" && !Number.isInteger(value)) ||
        (field.minimum !== undefined && Number(value) < field.minimum) ||
        (field.maximum !== undefined && Number(value) > field.maximum);
    } else if (field.type === "multi_select") {
      invalid =
        !Array.isArray(value) ||
        (field.minItems !== undefined && value.length < field.minItems) ||
        (field.maxItems !== undefined && value.length > field.maxItems) ||
        new Set(value).size !== value.length ||
        value.some(
          (item) => !field.options?.some((option) => option.value === item),
        );
    } else if (field.type === "boolean") {
      invalid = typeof value !== "boolean";
    } else {
      invalid =
        typeof value !== "string" ||
        (field.minLength !== undefined &&
          Array.from(String(value)).length < field.minLength) ||
        Array.from(String(value)).length > (field.maxLength ?? 2000) ||
        (field.type === "single_select" &&
          !field.options?.some((option) => option.value === value)) ||
        (field.format === "email" &&
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) ||
        (field.format === "uri" && !URL.canParse(String(value)));
    }
    return invalid
      ? [{ id: field.id, message: `Check the value for ${field.title}.` }]
      : [];
  });
}
function unsetSelectValue(field: ProductElicitationField): string {
  let value = `__rove_unset__:${field.id}`;
  while (field.options?.some((option) => option.value === value))
    value = `_${value}`;
  return value;
}

export function TaskDecisionSurface({
  entry,
  request,
  submitting,
  answers,
  form,
  onAnswer,
  onForm,
  onRespond,
  onExternal,
  onFocusDeparture,
  children,
}: {
  entry: ProductAttentionProjection;
  request: CustomerCollaborationRequest;
  submitting: boolean;
  answers: DecisionAnswers;
  form: DecisionForm;
  onAnswer(id: string, value: string[]): void;
  onForm(id: string, value: DecisionForm[string]): void;
  onRespond(
    decision: ProductAttentionDecision,
    answers: DecisionAnswers,
    form: DecisionForm,
  ): void;
  onExternal(): Promise<unknown>;
  onFocusDeparture(): void;
  children?: ReactNode;
}) {
  const surface = useRef<HTMLElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const focused = useRef(false);
  // Secret values never enter the Task-level form owner and die on departure.
  const [secretAnswers, setSecretAnswers] = useState<DecisionAnswers>({});
  const [issues, setIssues] = useState<{ id: string; message: string }[]>([]);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalPending, setExternalPending] = useState(false);
  const externalInFlight = useRef(false);
  const locked = submitting || request.responseState !== "pending";
  const bounded =
    entry.kind === "user_input" &&
    entry.questions?.length === 1 &&
    Boolean(entry.questions[0]?.options?.length);
  const actions = customerRequestActions(entry);
  useLayoutEffect(() => {
    const node = surface.current;
    if (
      document.activeElement === document.body &&
      !document.querySelector('[role="dialog"][aria-modal="true"]')
    )
      node?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    return () => {
      if (node?.contains(document.activeElement)) onFocusDeparture();
    };
  }, [onFocusDeparture]);
  useLayoutEffect(() => {
    if (locked) {
      setSecretAnswers({});
      if (
        (surface.current?.contains(document.activeElement) ||
          (focused.current && document.activeElement === document.body)) &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        status.current?.focus({ preventScroll: true });
    }
  }, [locked]);
  const reply = (decision: ProductAttentionDecision) => {
    if (locked) return;
    const submittedAnswers = Object.fromEntries(
      (entry.questions ?? []).map((question) => [
        question.id,
        (question.isSecret ? secretAnswers : answers)[question.id] ?? [],
      ]),
    );
    const submittedForm = { ...form };
    for (const field of entry.elicitation?.fields ?? [])
      if (
        field.type === "boolean" &&
        field.required &&
        submittedForm[field.id] === undefined
      )
        submittedForm[field.id] =
          typeof field.default === "boolean" ? field.default : false;
    const errors =
      decision === "accept"
        ? decisionValidation(entry, submittedAnswers, submittedForm)
        : [];
    setIssues(errors);
    if (errors.length) {
      surface.current
        ?.querySelector<HTMLElement>(
          `[data-response-field="${CSS.escape(errors[0]!.id)}"] input, [data-response-field="${CSS.escape(errors[0]!.id)}"] select`,
        )
        ?.focus();
      return;
    }
    if (
      decision === "accept" &&
      surface.current?.querySelector<HTMLInputElement>("input:invalid")
    ) {
      surface.current
        .querySelector<HTMLInputElement>("input:invalid")
        ?.reportValidity();
      return;
    }
    setSecretAnswers({});
    onRespond(decision, submittedAnswers, submittedForm);
  };
  const responseText =
    submitting && request.responseState === "pending"
      ? "Submitting your response…"
      : locked
        ? request.description
        : issues.map((issue) => issue.message).join(" ") || externalError || "";
  return (
    <section
      ref={surface}
      onFocusCapture={() => {
        focused.current = true;
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          focused.current = false;
      }}
      className={`attention-card attention-inline attention-codex task-decision-surface${bounded ? " task-choice-response" : ""}`}
      aria-label="Current task request"
      aria-busy={locked}
    >
      <header className="task-decision-heading">
        {entry.kind === "user_input" && (
          <div className="eyebrow">Rove needs your input</div>
        )}
        <h2 tabIndex={-1}>
          {bounded ? entry.questions![0]!.question : request.title}
        </h2>
      </header>
      <div
        className="task-decision-material"
        tabIndex={0}
        aria-label="Request details"
      >
        <p className="task-decision-instruction">
          {customerRequestDescription(entry)}
        </p>
        {entry.context?.length ? (
          <dl className="task-decision-context">
            {entry.context.map((item, index) => (
              <div key={`${item.label}:${index}`}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {actions
          .filter(
            (action) =>
              action.kind === "respond" && action.scope === "persistent_policy",
          )
          .map(
            (action) =>
              action.kind === "respond" && (
                <p className="task-decision-policy" key={action.id}>
                  <strong>{action.label}</strong>
                  <br />
                  {action.description}
                </p>
              ),
          )}
        {entry.questions?.map((question) => {
          const values = question.isSecret ? secretAnswers : answers;
          const selected = values[question.id]?.[0];
          const other = question.options?.some(
            (option) => option.label === selected,
          )
            ? ""
            : (selected ?? "");
          const setValue = (value: string) =>
            question.isSecret
              ? setSecretAnswers((current) => ({
                  ...current,
                  [question.id]: [value],
                }))
              : onAnswer(question.id, [value]);
          return (
            <fieldset
              key={question.id}
              data-response-field={question.id}
              className="task-response-options"
              disabled={locked}
            >
              <legend>{question.header}</legend>
              {!bounded && <p>{question.question}</p>}
              {question.options?.map((option, index) => (
                <label className="task-response-choice" key={option.label}>
                  <input
                    className="task-response-radio"
                    type="radio"
                    name={`${entry.requestId}:${question.id}`}
                    checked={selected === option.label}
                    onChange={() => setValue(option.label)}
                  />
                  <span className="task-response-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="task-response-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
              {(!question.options?.length || question.isOther) && (
                <label className="task-response-other">
                  <span>
                    {question.options?.length
                      ? "Something else"
                      : "Your answer"}
                  </span>
                  <input
                    aria-label={`${question.header} answer`}
                    type={question.isSecret ? "password" : "text"}
                    autoComplete={question.isSecret ? "off" : undefined}
                    placeholder={
                      question.options?.length ? "Something else…" : undefined
                    }
                    value={other}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </label>
              )}
              {question.isSecret && (
                <small>
                  Sent only with this response. Cleared when you submit or leave
                  this request.
                </small>
              )}
            </fieldset>
          );
        })}
        {entry.elicitation?.mode === "form" && (
          <div className="task-decision-form">
            {entry.elicitation.fields?.map((field) => {
              const value = form[field.id] ?? field.default;
              return (
                <label key={field.id} data-response-field={field.id}>
                  <span>
                    {field.title}
                    {field.required ? " (required)" : ""}
                  </span>
                  {field.description && <small>{field.description}</small>}
                  {field.type === "boolean" ? (
                    <input
                      aria-label={field.title}
                      type="checkbox"
                      disabled={locked}
                      checked={value === true}
                      onChange={(event) =>
                        onForm(field.id, event.target.checked)
                      }
                    />
                  ) : field.options ? (
                    <select
                      aria-label={field.title}
                      disabled={locked}
                      multiple={field.type === "multi_select"}
                      value={
                        field.type === "multi_select"
                          ? ((value as string[] | undefined) ?? [])
                          : String(value ?? unsetSelectValue(field))
                      }
                      onChange={(event) =>
                        onForm(
                          field.id,
                          field.type === "multi_select"
                            ? Array.from(event.target.selectedOptions).map(
                                (option) => option.value,
                              )
                            : event.target.value,
                        )
                      }
                    >
                      {field.type !== "multi_select" && (
                        <option value={unsetSelectValue(field)} disabled>
                          Choose…
                        </option>
                      )}
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={field.title}
                      disabled={locked}
                      type={
                        field.type === "number" || field.type === "integer"
                          ? "number"
                          : field.format === "email"
                            ? "email"
                            : field.format === "uri"
                              ? "url"
                              : field.format === "date"
                                ? "date"
                                : "text"
                      }
                      min={field.minimum}
                      max={field.maximum}
                      minLength={field.minLength}
                      maxLength={field.maxLength}
                      step={field.type === "integer" ? 1 : undefined}
                      placeholder={
                        field.format === "date-time"
                          ? "YYYY-MM-DDTHH:mm:ssZ"
                          : undefined
                      }
                      value={String(value ?? "")}
                      onChange={(event) =>
                        onForm(
                          field.id,
                          field.type === "number" || field.type === "integer"
                            ? event.target.valueAsNumber
                            : event.target.value,
                        )
                      }
                    />
                  )}
                </label>
              );
            })}
            {entry.elicitation.unsupportedReason && (
              <p role="alert">
                This request cannot be submitted:{" "}
                {entry.elicitation.unsupportedReason}
              </p>
            )}
          </div>
        )}
        {entry.elicitation?.mode === "url" && (
          <p className="task-decision-secure-note">
            Complete the step on the secure page, then Continue. Opening the
            page does not approve or submit this request.
          </p>
        )}
        {children}
      </div>
      <p
        ref={status}
        className="task-decision-status"
        role="status"
        tabIndex={-1}
      >
        {responseText || <span aria-hidden="true">&nbsp;</span>}
      </p>
      <div className="attention-actions task-decision-actions">
        {actions.map((action) =>
          action.kind === "trusted_external" ? (
            <button
              type="button"
              key={action.kind}
              className="primary"
              disabled={locked || externalPending}
              onClick={() => {
                if (externalInFlight.current || locked) return;
                externalInFlight.current = true;
                setExternalError(null);
                setExternalPending(true);
                void onExternal()
                  .catch(() =>
                    setExternalError(
                      "The secure page could not be opened. You can retry or decline the request.",
                    ),
                  )
                  .finally(() => {
                    externalInFlight.current = false;
                    setExternalPending(false);
                  });
              }}
            >
              {action.label}
            </button>
          ) : (
            <button
              type="button"
              key={action.id ?? String(action.decision)}
              className={
                action.scope === "once" ||
                (action.scope === undefined &&
                  action.decision === "accept" &&
                  entry.elicitation?.mode !== "url")
                  ? "primary"
                  : undefined
              }
              disabled={locked}
              onClick={() => reply(action.decision)}
            >
              {action.description ? (
                <>
                  <span>{action.label}</span>
                  <small>
                    {action.scope === "persistent_policy"
                      ? "Updates saved policy. Review the full rule above."
                      : action.description}
                  </small>
                </>
              ) : (
                action.label
              )}
            </button>
          ),
        )}
      </div>
    </section>
  );
}

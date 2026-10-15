import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { PostApiFeesData, TokenWithChain } from "@/api/types.gen";
import { CheckboxGroup } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { shortAddress } from "@/lib/format";
import { nextRowId } from "@/lib/utils";

export type Condition = PostApiFeesData["body"]["condition"];

type Subject =
  "customerId" | "trait" | "sourceToken" | "targetToken" | "sourceAmount";
type Op = "_eq" | "_in" | "_gt" | "_gte" | "_lt" | "_lte";
type ValueType = "string" | "number" | "boolean";

export type Rule = {
  id: number;
  subject: Subject;
  // The trait's path inside the customer's traits, e.g. "plan" or "address.country".
  path: string;
  op: Op;
  // Lists are kept comma separated.
  value: string;
  type: ValueType;
};

const subjects: Record<Subject, { label: string; ops: Op[] }> = {
  customerId: { label: "Customer ID", ops: ["_eq", "_in"] },
  trait: { label: "Customer trait", ops: ["_eq", "_in"] },
  sourceToken: { label: "Source token", ops: ["_eq", "_in"] },
  targetToken: { label: "Target token", ops: ["_eq", "_in"] },
  sourceAmount: {
    label: "Source amount",
    ops: ["_gte", "_gt", "_lte", "_lt", "_eq"],
  },
};

const opLabels: Record<Op, string> = {
  _eq: "is",
  _in: "is one of",
  _gt: "is more than",
  _gte: "is at least",
  _lt: "is less than",
  _lte: "is at most",
};

const typeLabels: Record<ValueType, string> = {
  string: "Text",
  number: "Number",
  boolean: "True / false",
};

const newRule = (subject: Subject, id: number): Rule => ({
  id,
  subject,
  path: "",
  op: subjects[subject].ops[0],
  value: "",
  type: "string",
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const scalarType = (value: unknown): ValueType | null =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean"
    ? (typeof value as ValueType)
    : null;

const splitList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * The rules a stored condition is made of, or null when it holds something
 * the builder can't show (such a condition is edited as JSON instead).
 */
export const toRules = (condition: Record<string, unknown>): Rule[] | null => {
  const rules: Rule[] = [];

  // One rule per operator of an { _eq, _in } filter, when its values are all
  // of one of `types`.
  const eqIn = (
    filter: unknown,
    subject: Subject,
    path: string,
    types: ValueType[],
  ) =>
    isRecord(filter) &&
    Object.entries(filter).every(([op, value]) => {
      const list = op === "_in" && Array.isArray(value) ? value : null;
      const items = list ?? (op === "_eq" ? [value] : []);
      const type = scalarType(items[0]);

      if (
        !type ||
        !types.includes(type) ||
        items.some((item) => scalarType(item) !== type) ||
        (list &&
          (type === "boolean" ||
            items.some((item) => String(item).includes(","))))
      ) {
        return false;
      }

      const text = items.join(", ");
      rules.push({
        ...newRule(subject, rules.length),
        path,
        op: op as Op,
        value:
          subject === "sourceToken" || subject === "targetToken"
            ? text.toLowerCase()
            : text,
        type,
      });
      return true;
    });

  return Object.entries(condition).every(([name, filter]) => {
    if (!isRecord(filter)) return false;

    switch (name) {
      case "customer":
        return Object.entries(filter).every(([key, value]) =>
          key === "id"
            ? eqIn(value, "customerId", "", ["string"])
            : key.startsWith("traits.") &&
              eqIn(value, "trait", key.slice(7), [
                "string",
                "number",
                "boolean",
              ]),
        );

      case "sourceCurrency":
      case "targetCurrency": {
        const subject =
          name === "sourceCurrency" ? "sourceToken" : "targetToken";
        return Object.entries(filter).every(
          ([key, value]) =>
            key === "contractAddress" && eqIn(value, subject, "", ["string"]),
        );
      }

      case "sourceAmount":
        return Object.entries(filter).every(([op, value]) => {
          if (
            !subjects.sourceAmount.ops.includes(op as Op) ||
            typeof value !== "string"
          ) {
            return false;
          }

          rules.push({
            ...newRule("sourceAmount", rules.length),
            op: op as Op,
            value,
          });
          return true;
        });

      default:
        return false;
    }
  })
    ? rules
    : null;
};

const ruleValue = (rule: Rule): { value: unknown } | { error: string } => {
  const label = subjects[rule.subject].label;

  if (rule.subject === "sourceAmount") {
    return /^[0-9]+$/.test(rule.value.trim())
      ? { value: rule.value.trim() }
      : { error: `${label} must be a whole number of base units` };
  }

  if (rule.type === "boolean") return { value: rule.value === "true" };

  const items = rule.op === "_in" ? splitList(rule.value) : [rule.value.trim()];
  if (!items.length || items.some((item) => !item)) {
    return {
      error:
        rule.subject === "sourceToken" || rule.subject === "targetToken"
          ? `Pick a ${label.toLowerCase()}`
          : `Fill in a value for ${label.toLowerCase()}`,
    };
  }

  if (rule.type === "number") {
    const numbers = items.map(Number);
    if (numbers.some((number) => !Number.isFinite(number))) {
      return { error: `${rule.path || label} must be a number` };
    }

    return { value: rule.op === "_in" ? numbers : numbers[0] };
  }

  return { value: rule.op === "_in" ? items : items[0] };
};

/** The condition the API takes, built from the rules. */
export const fromRules = (
  rules: Rule[],
): { condition: Condition } | { error: string } => {
  const customer: Record<string, Record<string, unknown>> = {};
  const sourceToken: Record<string, unknown> = {};
  const targetToken: Record<string, unknown> = {};
  const sourceAmount: Record<string, unknown> = {};

  for (const rule of rules) {
    const path = rule.path.trim();
    if (rule.subject === "trait" && !/^[^.]+(\.[^.]+)*$/.test(path)) {
      return { error: "Name the trait each condition checks, like plan" };
    }

    const filter =
      rule.subject === "customerId"
        ? (customer.id ??= {})
        : rule.subject === "trait"
          ? (customer[`traits.${path}`] ??= {})
          : rule.subject === "sourceToken"
            ? sourceToken
            : rule.subject === "targetToken"
              ? targetToken
              : sourceAmount;

    if (rule.op in filter) {
      const name =
        rule.subject === "trait" ? path : subjects[rule.subject].label;
      return {
        error: `Only one "${name} ${opLabels[rule.op]}" condition is allowed`,
      };
    }

    const result = ruleValue(rule);
    if ("error" in result) return result;
    filter[rule.op] = result.value;
  }

  const condition: Condition = {};
  if (Object.keys(customer).length) condition.customer = customer;
  if (Object.keys(sourceToken).length) {
    condition.sourceCurrency = { contractAddress: sourceToken };
  }
  if (Object.keys(targetToken).length) {
    condition.targetCurrency = { contractAddress: targetToken };
  }
  if (Object.keys(sourceAmount).length) condition.sourceAmount = sourceAmount;

  return { condition };
};

const TokenValue = ({
  rule,
  tokens,
  onChange,
}: {
  rule: Rule;
  tokens: TokenWithChain[];
  onChange: (value: string) => void;
}) => {
  const selected = splitList(rule.value);
  // Addresses the chain has no token for still show, so nothing is dropped.
  const options = [
    ...tokens.map((token) => ({
      value: token.address.toLowerCase(),
      label: token.symbol,
    })),
    ...selected
      .filter(
        (address) =>
          !tokens.some((token) => token.address.toLowerCase() === address),
      )
      .map((address) => ({ value: address, label: shortAddress(address) })),
  ];

  if (rule.op === "_in") {
    return options.length ? (
      <CheckboxGroup
        options={options}
        value={selected}
        onChange={(value) => onChange(value.join(","))}
      />
    ) : (
      <p className="text-xs text-muted">This chain has no tokens yet.</p>
    );
  }

  return (
    <Select
      required
      aria-label="Token"
      value={rule.value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        {options.length ? "Choose a token" : "This chain has no tokens yet"}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
};

const RuleValue = ({
  rule,
  tokens,
  onChange,
}: {
  rule: Rule;
  tokens: TokenWithChain[];
  onChange: (patch: Partial<Rule>) => void;
}) => {
  const list = rule.op === "_in";

  switch (rule.subject) {
    case "sourceToken":
    case "targetToken":
      return (
        <TokenValue
          rule={rule}
          tokens={tokens}
          onChange={(value) => onChange({ value })}
        />
      );

    case "sourceAmount":
      return (
        <Input
          required
          inputMode="numeric"
          pattern="[0-9]+"
          title="A whole number of the token's base units"
          placeholder="Amount in the paid token's base units"
          aria-label="Amount"
          value={rule.value}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      );

    case "customerId":
      return (
        <Input
          required
          className="font-mono placeholder:font-sans"
          placeholder={list ? "Customer IDs, comma separated" : "Customer ID"}
          aria-label="Customer ID"
          value={rule.value}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      );

    case "trait":
      return (
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)] gap-2">
          <Input
            required
            placeholder="Trait, e.g. plan"
            aria-label="Trait"
            value={rule.path}
            onChange={(event) => onChange({ path: event.target.value })}
          />
          <Select
            aria-label="Value type"
            value={rule.type}
            onChange={(event) => {
              const type = event.target.value as ValueType;
              onChange(
                type === "boolean"
                  ? { type, op: "_eq", value: "true" }
                  : { type, value: rule.type === "boolean" ? "" : rule.value },
              );
            }}
          >
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {rule.type === "boolean" ? (
            <Select
              aria-label="Value"
              value={rule.value}
              onChange={(event) => onChange({ value: event.target.value })}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </Select>
          ) : (
            <Input
              required
              inputMode={rule.type === "number" ? "decimal" : undefined}
              placeholder={list ? "Values, comma separated" : "Value"}
              aria-label="Value"
              value={rule.value}
              onChange={(event) => onChange({ value: event.target.value })}
            />
          )}
        </div>
      );
  }
};

export const ConditionBuilder = ({
  rules,
  tokens,
  onChange,
}: {
  rules: Rule[];
  tokens: TokenWithChain[];
  onChange: (rules: Rule[]) => void;
}) => {
  const update = (id: number, patch: Partial<Rule>) =>
    onChange(
      rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );

  return (
    <div className="space-y-2">
      {rules.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {rules.map((rule) => (
            <div key={rule.id} className="space-y-2 p-3">
              <div className="flex gap-2">
                <Select
                  aria-label="Condition"
                  wrapperClassName="min-w-0 flex-1"
                  value={rule.subject}
                  onChange={(event) => {
                    const { id } = rule;
                    onChange(
                      rules.map((item) =>
                        item.id === id
                          ? newRule(event.target.value as Subject, id)
                          : item,
                      ),
                    );
                  }}
                >
                  {Object.entries(subjects).map(([value, subject]) => (
                    <option key={value} value={value}>
                      {subject.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Comparison"
                  wrapperClassName="w-36 shrink-0"
                  value={rule.op}
                  onChange={(event) =>
                    update(rule.id, {
                      op: event.target.value as Op,
                      ...(rule.subject === "sourceToken" ||
                      rule.subject === "targetToken"
                        ? { value: splitList(rule.value)[0] ?? "" }
                        : {}),
                    })
                  }
                >
                  {subjects[rule.subject].ops
                    .filter((op) => rule.type !== "boolean" || op === "_eq")
                    .map((op) => (
                      <option key={op} value={op}>
                        {opLabels[op]}
                      </option>
                    ))}
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted hover:text-danger"
                  aria-label="Remove condition"
                  onClick={() =>
                    onChange(rules.filter((item) => item.id !== rule.id))
                  }
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>
              <RuleValue
                rule={rule}
                tokens={tokens}
                onChange={(patch) => update(rule.id, patch)}
              />
            </div>
          ))}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...rules, newRule("sourceAmount", nextRowId(rules))])
        }
      >
        <IconPlus className="size-4" />
        Add condition
      </Button>
    </div>
  );
};

type Maybe<T> = T | null | undefined;
type ComparisonOperator = "_eq" | "_gt" | "_lt" | "_gte" | "_lte" | "_neq";
type ThresholdOperator = Exclude<ComparisonOperator, "_neq">;

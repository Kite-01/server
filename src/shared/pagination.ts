export type PageInput = {
  page?: number;
  pageSize?: number;
};

export type WithPageInput<T> = T & PageInput;

export type Paginated<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const DefaultPageSize = 20;
export const MaxPageSize = 100;

export const paginate = async <T>(
  input: PageInput,
  fetchRows: (limit: number, offset: number) => Promise<T[]>,
  countRows: () => Promise<number>,
): Promise<Paginated<T>> => {
  const page = Math.max(Math.trunc(input.page ?? 1), 1);
  const pageSize = Math.min(
    Math.max(Math.trunc(input.pageSize ?? DefaultPageSize), 1),
    MaxPageSize,
  );

  const [data, total] = await Promise.all([
    fetchRows(pageSize, (page - 1) * pageSize),
    countRows(),
  ]);

  return {
    data,
    page,
    pageSize,
    total,
  };
};

export const searchPattern = (q: string) => {
  return `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;
};

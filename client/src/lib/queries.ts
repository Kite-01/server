import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { toast } from "sonner";
import { request } from "./api";

export type Page<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

type Query = Record<string, string | number | boolean | null | undefined>;

export const AppScope = createContext<{ appId?: string; name?: string }>({});

export const useAppScope = () => useContext(AppScope);

export const useGet = <T>(
  path: string,
  query?: Query,
  options: { enabled?: boolean; refetchInterval?: number } = {},
) => {
  const { appId } = useAppScope();

  return useQuery({
    queryKey: [appId ?? "root", path, query ?? {}] as QueryKey,
    queryFn: () => request<T>("GET", path, { query, appId }),
    ...options,
  });
};

export const useMutate = <TBody = void, TResult = unknown>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string | ((body: TBody) => string),
  options: { success?: string; onSuccess?: (result: TResult) => void } = {},
) => {
  const { appId } = useAppScope();
  const queryClient = useQueryClient();

  return useMutation<TResult, Error, TBody>({
    mutationFn: (body) =>
      request<TResult>(method, typeof path === "function" ? path(body) : path, {
        body: method === "DELETE" || body === undefined ? undefined : body,
        appId,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries();
      if (options.success) toast.success(options.success);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(error.message),
  });
};

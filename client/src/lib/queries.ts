import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { toast } from "sonner";

export const AppScope = createContext<{ appId?: string; name?: string }>({});

export const useAppScope = () => useContext(AppScope);

export const useAppHeaders = () => {
  const { appId } = useAppScope();
  return appId ? { "x-kite-app-id": appId } : undefined;
};

export const useMutate = <TData, TVariables>(
  options: UseMutationOptions<TData, Error, TVariables>,
  {
    success,
    onSuccess,
  }: { success?: string; onSuccess?: (data: TData) => void } = {},
) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,
    onSuccess: (data) => {
      void queryClient.invalidateQueries();
      if (success) toast.success(success);
      onSuccess?.(data);
    },
    onError: (error) => toast.error(error.message),
  });
};

import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { getApiAppsOptions } from "@/api/@tanstack/react-query.gen";
import { Shell } from "@/components/shell";
import { AppScope } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { ApiKeys } from "@/pages/api-keys";
import { Apps } from "@/pages/apps";
import { ChainDetail } from "@/pages/chain-detail";
import { Chains } from "@/pages/chains";
import { Customers } from "@/pages/customers";
import { Dashboard } from "@/pages/dashboard";
import { Fees } from "@/pages/fees";
import { Kv } from "@/pages/kv";
import { Login } from "@/pages/login";
import { PaymentLinks } from "@/pages/payment-links";
import { PriceFeeds } from "@/pages/price-feeds";
import { Quotes } from "@/pages/quotes";
import { Transfers } from "@/pages/transfers";
import { Webhooks } from "@/pages/webhooks";

const AppRoute = () => {
  const { appId } = useParams();
  const { data, error } = useQuery(
    getApiAppsOptions({ headers: { "x-kite-app-id": appId! } }),
  );

  if (error) return <Navigate to="/apps" replace />;

  return (
    <AppScope.Provider value={{ appId, name: data?.name }}>
      <Shell />
    </AppScope.Provider>
  );
};

export const App = () => {
  const { status } = useSession();

  if (status === "loading") return null;
  if (status === "signed-out") return <Login />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="chains" element={<Chains />} />
        <Route path="chains/:chainId" element={<ChainDetail />} />
        <Route path="fees" element={<Fees />} />
        <Route path="apps" element={<Apps />} />
        <Route path="kv" element={<Kv />} />
        <Route path="price-feeds" element={<PriceFeeds />} />
      </Route>

      <Route path="apps/:appId" element={<AppRoute />}>
        <Route index element={<Dashboard />} />
        <Route path="fees" element={<Fees />} />
        <Route path="customers" element={<Customers />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="payment-links" element={<PaymentLinks />} />
        <Route path="quotes" element={<Quotes />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="webhooks" element={<Webhooks />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

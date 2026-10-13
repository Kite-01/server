import { UuidIdParams, PageQuery } from "../schema";
import { CustomerService } from "../../services/Customer.service";
import { ApiKeyScope } from "../../shared/constants";
import { HttpError } from "../../shared/errors";
import { Elysia } from "elysia";
import { Scope } from "../middlewares/scope";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const customerService = new CustomerService();

export const customerRoutes = new Elysia({ name: "CustomersRoute" })
  .use(Auth.plugin)
  .post(
    "/customers",
    ({ actor, body }) => {
      return customerService.upsertCustomer({
        ...body,
        appId: Auth.requireAppId(actor),
      });
    },
    {
      body: t.Object({
        externalId: t.String({
          minLength: 1,
          maxLength: 255,
        }),
        name: t.Optional(
          t.Union([
            t.Null(),
            t.String({
              maxLength: 255,
            }),
          ]),
        ),
        traits: t.Optional(
          t.Union([t.Record(t.String(), t.Unknown()), t.Null()]),
        ),
      }),
      beforeHandle: Auth.access({ scope: ApiKeyScope.CustomerWrite }),
      detail: {
        tags: ["Customers"],
        summary: "Create a customer, or update the one with this externalId",
      },
    },
  )
  .get(
    "/customers",
    ({ actor, query }) => {
      return customerService.getCustomers({
        ...query,
        appId: actor.appId,
      });
    },
    {
      query: t.Object({
        externalId: t.Optional(
          t.String({
            maxLength: 255,
          }),
        ),
        q: t.Optional(
          t.String({
            maxLength: 100,
          }),
        ),
        ...PageQuery,
      }),
      beforeHandle: Auth.access({ scope: ApiKeyScope.CustomerRead }),
      detail: {
        tags: ["Customers"],
        summary: "List customers",
      },
    },
  )
  .get(
    "/customers/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "customer", params.id);
      const customer = await customerService.getCustomerById(appId, params.id);

      if (!customer) throw new HttpError(404, "NotFound", "Customer not found");
      return customer;
    },
    {
      params: UuidIdParams,
      beforeHandle: Auth.access({
        scope: ApiKeyScope.CustomerRead,
        public: true,
      }),
      detail: {
        tags: ["Customers"],
        summary: "Get a customer",
      },
    },
  )
  .delete(
    "/customers/:id",
    async ({ actor, params }) => {
      const appId = await Scope.appFor(actor, "customer", params.id);
      const customer = await customerService.deleteCustomer(appId, params.id);

      if (!customer) throw new HttpError(404, "NotFound", "Customer not found");
      return customer;
    },
    {
      params: UuidIdParams,
      beforeHandle: Auth.access({ scope: ApiKeyScope.CustomerDelete }),
      detail: {
        tags: ["Customers"],
        summary: "Delete a customer",
      },
    },
  );

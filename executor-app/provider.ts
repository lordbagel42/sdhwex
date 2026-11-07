import {
  type AccountCheckContext,
  decodeJson,
  defineProvider,
  header,
  literal,
  object,
  plain,
  secrets,
  string,
} from "apps";

const auth = {
  globalApiKey: secrets({
    label: "Cloudflare email and Global API Key",
    fields: object({
      email: plain(string({ minLength: 1 })),
      globalApiKey: string({ minLength: 1 }),
    }),
    request: ({ globalApiKey }) => header("X-Auth-Key", globalApiKey),
  }),
};

const UserResponse = object({
  success: literal(true),
  result: object({
    id: string({ minLength: 1 }),
    email: string({ minLength: 1 }),
  }),
});

export async function checkAccount({
  account,
  fetch,
  signal,
}: AccountCheckContext<typeof auth>) {
  const response = await fetch("https://api.cloudflare.com/client/v4/user", {
    signal,
    redirect: "manual",
    headers: {
      ...account.headers(),
      "X-Auth-Email": account.fields.email,
      Accept: "application/json",
    },
  });
  const { result } = await decodeJson(response, UserResponse);
  return { accountInfo: { externalId: result.id, email: result.email } };
}

export const provider = defineProvider({
  name: "Cloudflare Global API Key",
  hosts: ["api.cloudflare.com"],
  auth,
  health: checkAccount,
});

import { gql } from "@apollo/client";
import { getAPIServiceClient } from "src/backend/graphql";
import { generateAnalyticsJWT, generateAPIKeyJWT } from "src/backend/jwts";
import { errorUnauthenticated } from "src/backend/errors";
import { NextApiRequest, NextApiResponse } from "next";
import getConfig from "next/config";
import { getTokenFromCookie } from "src/backend/cookies";
import { verifyHashedSecret } from "src/backend/utils";
const { publicRuntimeConfig } = getConfig();

export default async function handleGraphQL(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!publicRuntimeConfig.NEXT_PUBLIC_GRAPHQL_API_URL) {
    throw new Error(
      "Improperly configured. `NEXT_PUBLIC_GRAPHQL_API_URL` env var must be set."
    );
  }

  const authorization = req.headers["authorization"]?.replace("Bearer ", "");

  // Strictly set the necessary properties to avoid passing other headers that wreak havoc (e.g. SSL certs collisions)
  const headers = new Headers();
  headers.append(
    "Content-Type",
    req.headers["content-type"] || "application/json"
  );

  // Check if request is authenticated with API key
  if (authorization?.startsWith("api_")) {
    const [key_id, secret] = Buffer.from(
      authorization.replace("api_", ""),
      "base64"
    )
      .toString()
      .split(":");

    // Get the hashed secret from the database
    const client = await getAPIServiceClient();
    const apiKeyQuery = gql`
      query ApiKeyQuery($key_id: String!) {
        api_key(where: { id: { _eq: $key_id }, is_active: { _eq: true } }) {
          id
          team_id
          api_key
        }
      }
    `;
    const response = await client.query({
      query: apiKeyQuery,
      variables: { key_id: key_id },
    });
    if (!response.data.api_key.length) {
      return errorUnauthenticated("Invalid or inactive API key.", res);
    }

    // Verify the secret against the given API key
    if (!verifyHashedSecret(key_id, secret, response.data.api_key[0].api_key)) {
      return errorUnauthenticated("Invalid API key secret.", res);
    }

    headers.delete("Authorization");
    headers.append(
      "Authorization",
      `Bearer ${await generateAPIKeyJWT(response.data.api_key[0].team_id)}`
    );
  }

  // Check if request is from the analytics service
  if (authorization?.startsWith("analytics_")) {
    if (authorization !== process.env.ANALYTICS_API_KEY) {
      return errorUnauthenticated("Invalid analytics API key", res);
    }

    headers.delete("Authorization");
    headers.append("Authorization", `Bearer ${await generateAnalyticsJWT()}`);
  }

  let body: string | undefined = undefined;
  try {
    body = JSON.stringify(req.body);
  } catch {}

  if (!body) {
    return res.status(415).json({
      code: "unsupported_media_type",
      detail: "The body request does not look like a valid JSON payload.",
      attr: null,
    });
  }

  if (!headers.get("authorization")) {
    // Check if request is authenticated with user token (cookie)
    const token = getTokenFromCookie(req, res);

    if (token) {
      headers.append("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(
    publicRuntimeConfig.NEXT_PUBLIC_GRAPHQL_API_URL,
    {
      method: req.method,
      // @ts-ignore
      headers,
      body,
    }
  );

  res.status(response.status).json(await response.json());
}

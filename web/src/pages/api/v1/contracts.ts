import { NextApiRequest, NextApiResponse } from "next";
import { gql } from "@apollo/client";
import { getAPIServiceClient } from "src/backend/graphql";
import { errorNotAllowed } from "src/backend/errors";

/**
 * Fetches the World ID contract addresses (Semaphore) from the local cache.
 * @param req
 * @param res
 */
export default async function handleContracts(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!req.method || !["GET", "OPTIONS"].includes(req.method)) {
    return errorNotAllowed(req.method, res);
  }

  const query = gql`
    query ENS {
      cache(where: { key: { _iregex: "[a-z.]+.wld.eth" } }) {
        key
        value
      }
    }
  `;

  const client = await getAPIServiceClient();
  const response = await client.query({
    query,
  });

  res.status(200).json(response.data.cache);
}

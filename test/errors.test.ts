import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/errors.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

test("JSON-RPC errors are clean-error with their code", () => {
  const classified = classify(new McpError(ErrorCode.InvalidParams, "bad"));
  assert.equal(classified.kind, "clean-error");
  assert.equal(classified.code, ErrorCode.InvalidParams);
});

test("request timeout classifies as timeout", () => {
  const classified = classify(new McpError(ErrorCode.RequestTimeout, "slow"));
  assert.equal(classified.kind, "timeout");
});

test("connection closed classifies as closed", () => {
  const classified = classify(new McpError(ErrorCode.ConnectionClosed, "gone"));
  assert.equal(classified.kind, "closed");
});

test("a StreamableHTTPError-shaped error becomes http-error with its status", () => {
  // Mirror the SDK's StreamableHTTPError: name + numeric .code carrying the HTTP status.
  const err = Object.assign(new Error("Error POSTing to endpoint: unauthorized"), {
    name: "StreamableHTTPError",
    code: 401,
  });
  const classified = classify(err);
  assert.equal(classified.kind, "http-error");
  assert.equal(classified.httpStatus, 401);
});

test("a plain transport-closed message classifies as closed", () => {
  assert.equal(classify(new Error("Connection closed")).kind, "closed");
});

test("an unrecognized error is unknown", () => {
  assert.equal(classify(new Error("something weird")).kind, "unknown");
});

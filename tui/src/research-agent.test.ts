import { expect, test } from "bun:test";
import { summarizeToolCall } from "./research-agent.ts";

test("summarizes important tool arguments", () => {
  expect(
    summarizeToolCall("deep_search", {
      query: "best recent sources about terminal UI research assistants",
      find: "pricing",
    }),
  ).toBe('deep_search query="best recent sources about terminal UI research assistants" find="pricing"');

  expect(
    summarizeToolCall("read_file_lines", {
      filename: "src/research-agent.ts",
      startline: 1,
      endline: 40,
    }),
  ).toBe("read_file_lines file=src/research-agent.ts lines=1-40");

  expect(
    summarizeToolCall("bash", {
      command: "bun test src/research-agent.test.ts",
    }),
  ).toBe('bash command="bun test src/research-agent.test.ts"');
});

test("truncates long tool argument values", () => {
  expect(
    summarizeToolCall("web_search", {
      query: "a".repeat(80),
    }),
  ).toBe(`web_search query="${"a".repeat(57)}..."`);
});

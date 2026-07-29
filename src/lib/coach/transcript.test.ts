import { describe, expect, it } from "vitest";

import { toTranscript } from "./transcript";

describe("rebuilding a stored conversation", () => {
  it("keeps what was said", () => {
    expect(
      toTranscript([
        { role: "user", content: "Why has my bench stalled?" },
        { role: "assistant", content: [{ type: "text", text: "It has not — you missed two weeks." }] },
      ]),
    ).toEqual([
      { role: "user", text: "Why has my bench stalled?" },
      { role: "assistant", text: "It has not — you missed two weeks." },
    ]);
  });

  it("drops the machinery", () => {
    /*
     * A saved turn contains thinking, the tool call and the tool's JSON. All of
     * it is needed to replay the conversation to the API, and none of it is
     * worth showing three days later — the tool calls were already narrated
     * while they ran.
     */
    const transcript = toTranscript([
      { role: "user", content: "How is my volume?" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Check chest first…", signature: "abc" },
          { type: "tool_use", id: "t1", name: "get_volume_by_muscle", input: { weeks: 8 } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"muscles\":[]}" }],
      },
      { role: "assistant", content: [{ type: "text", text: "Chest is under MEV." }] },
    ]);

    expect(transcript).toEqual([
      { role: "user", text: "How is my volume?" },
      { role: "assistant", text: "Chest is under MEV." },
    ]);
  });

  it("joins split text blocks", () => {
    expect(
      toTranscript([
        { role: "assistant", content: [{ type: "text", text: "One. " }, { type: "text", text: "Two." }] },
      ]),
    ).toEqual([{ role: "assistant", text: "One. Two." }]);
  });

  it("survives content it does not recognise", () => {
    // Stored content is whatever the API returned at the time, which may gain
    // block types later. An unknown block should be ignored, not thrown on.
    expect(
      toTranscript([
        { role: "assistant", content: [{ type: "something_new", payload: 1 }] },
        { role: "assistant", content: null },
      ]),
    ).toEqual([]);
  });
});

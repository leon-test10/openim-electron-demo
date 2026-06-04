import { Empty, Timeline, Typography } from "antd";

import { CodexRuntimeEvent } from "@/types/codex";

interface CodexRuntimeTraceProps {
  events: CodexRuntimeEvent[];
}

export default function CodexRuntimeTrace({ events }: CodexRuntimeTraceProps) {
  if (!events.length) {
    return (
      <Empty
        className="my-3"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No runtime events"
      />
    );
  }

  return (
    <Timeline
      className="mt-3"
      items={events.slice(-20).map((event) => ({
        key: event.id,
        children: (
          <div className="text-xs">
            <div className="font-medium">{event.title}</div>
            {event.summary ? (
              <Typography.Paragraph
                className="m-0 text-xs text-[var(--sub-text)]"
                ellipsis={{ rows: 2, expandable: true }}
              >
                {event.summary}
              </Typography.Paragraph>
            ) : (
              <div className="text-[var(--sub-text)]">{event.eventType}</div>
            )}
          </div>
        ),
      }))}
    />
  );
}

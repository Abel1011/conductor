const config = require("./config");

async function sendSlackMessage(text) {
  if (!config.slackBotToken || !config.slackChannelId) {
    return { skipped: true };
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slackBotToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      channel: config.slackChannelId,
      text
    })
  });

  const body = await response.json();
  if (!body.ok) {
    throw new Error(`Slack API error: ${body.error || response.statusText}`);
  }

  return body;
}

module.exports = {
  sendSlackMessage
};
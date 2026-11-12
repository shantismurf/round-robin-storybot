/**
 * _editPanelReply.js — showing the edit panel after a click on a message that isn't the panel.
 *
 * Discord gives a bot 15 minutes to edit its reply to an interaction, after which that
 * interaction's token is dead ("Invalid Webhook Token", 50027). The edit panel used to redraw
 * itself through the interaction that opened it, so the whole panel stopped responding 15
 * minutes after `/story edit`. Every click brings an interaction with a fresh token, so the
 * panel now redraws through the click: `interaction.editReply()` after `deferUpdate()` edits the
 * message the clicked component sits on (discord.js InteractionResponses#editReply targets
 * '@original', which for a component interaction is that message).
 *
 * That covers buttons on the panel itself. A few actions are confirmed from a message of their
 * own — the import confirm, the writer picker, a History restore — and those can't reach the
 * panel with a fresh token at all. This turns that message into the updated panel instead, and
 * retires the old panel while Discord still allows it. Past the 15 minutes the old panel stays
 * on screen, stale until clicked, and its buttons still work for the same reason as above.
 */

import { log } from '../utilities.js';

/**
 * Render `message` into the message the user just clicked on, then delete the panel it
 * replaces if that panel's token is still alive. The caller must already have deferred
 * (`deferUpdate()`) the interaction.
 *
 * Leaves `state.originalInteraction` pointing at this click, so the next late delete targets the
 * panel that is actually on screen now.
 *
 * @param {import('discord.js').MessageComponentInteraction} interaction the click, already deferred
 * @param {object} state the edit session
 * @param {object} message the panel payload to show
 */
export async function promoteToPanel(interaction, state, message) {
  await interaction.editReply(message);

  const previous = state.originalInteraction;
  state.originalInteraction = interaction;
  if (!previous || previous === interaction) return;

  try {
    await previous.deleteReply();
  } catch (err) {
    // Expected once the old panel is more than 15 minutes old: it stays on screen and its
    // buttons keep working, so this is a trace, not a problem.
    log(`promoteToPanel: old panel for entry ${state.entryId} left in place (user ${interaction.user?.username}): ${err?.message ?? err}`, { show: false, guildName: interaction?.guild?.name });
  }
}

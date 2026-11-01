import assert from 'node:assert/strict';
import test from 'node:test';

import { PageAgentPluginSwitches } from '../src/services/pageAgent/pageAgentPlugins.ts';

const ON_BY_DEFAULT = { id: 'on-plugin', title: 'On', description: '', defaultEnabled: true };
const OFF_BY_DEFAULT = { id: 'off-plugin', title: 'Off', description: '', defaultEnabled: false };

test('a plugin the user never switched takes its default', () =>
{
  const switches = new PageAgentPluginSwitches({});

  assert.equal(switches.isEnabled(ON_BY_DEFAULT), true);
  assert.equal(switches.isEnabled(OFF_BY_DEFAULT), false);
});

test('a stored value overrides the default either way', () =>
{
  const switches = new PageAgentPluginSwitches({ 'on-plugin': false, 'off-plugin': true });

  assert.equal(switches.isEnabled(ON_BY_DEFAULT), false);
  assert.equal(switches.isEnabled(OFF_BY_DEFAULT), true);
});

test('with returns new switches and leaves the old ones unchanged', () =>
{
  const before = new PageAgentPluginSwitches({ 'off-plugin': true });

  const after = before.with('on-plugin', false);

  assert.notEqual(after, before);
  assert.equal(after.isEnabled(ON_BY_DEFAULT), false);
  assert.equal(after.isEnabled(OFF_BY_DEFAULT), true);
  assert.equal(before.isEnabled(ON_BY_DEFAULT), true);
  assert.deepEqual(before.toStored(), { 'off-plugin': true });
  assert.deepEqual(after.toStored(), { 'off-plugin': true, 'on-plugin': false });
});

test('enabledIds lists Video transcripts by default and drops it once switched off', () =>
{
  assert.deepEqual(new PageAgentPluginSwitches({}).enabledIds(), ['video-transcripts']);
  assert.deepEqual(new PageAgentPluginSwitches({ 'video-transcripts': false }).enabledIds(), []);
});

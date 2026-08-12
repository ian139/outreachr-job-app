import { useMemo, useState } from 'react';
import { Database, LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { Button, TextField } from '../components/ui';
import { useWorkspace } from '../state/WorkspaceContext';

interface StageDraft {
  key: number;
  name: string;
  terminal: boolean;
}

export function WorkspaceSetupPage(): React.JSX.Element {
  const { command, notify } = useWorkspace();
  const [displayName, setDisplayName] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [stages, setStages] = useState<StageDraft[]>([
    { key: 1, name: '', terminal: false },
    { key: 2, name: '', terminal: false },
  ]);
  const [nextKey, setNextKey] = useState(3);
  const [saving, setSaving] = useState(false);

  const valid = useMemo(() => {
    const names = stages.map((stage) => stage.name.trim());
    return (
      displayName.trim().length > 0 &&
      /.+@.+\..+/.test(primaryEmail) &&
      names.length >= 2 &&
      names.every(Boolean) &&
      new Set(names.map((name) => name.toLocaleLowerCase())).size === names.length
    );
  }, [displayName, primaryEmail, stages]);

  const updateStage = (key: number, patch: Partial<Pick<StageDraft, 'name' | 'terminal'>>): void => {
    setStages((current) =>
      current.map((stage) => (stage.key === key ? { ...stage, ...patch } : stage)),
    );
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await command('workspace.setup', {
        displayName: displayName.trim(),
        primaryEmail: primaryEmail.trim(),
        stages: stages.map(({ name, terminal }) => ({ name: name.trim(), terminal })),
      });
      notify({
        tone: 'success',
        title: 'Job application workspace ready',
        detail: 'Your stages and local profile were saved to the encrypted workspace.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="job-setup-shell">
      <section className="job-setup-intro" aria-labelledby="job-setup-title">
        <div className="brand-mark" aria-hidden="true">
          O
        </div>
        <p className="eyebrow">Private, local-first workspace</p>
        <h1 id="job-setup-title">Set up your job search</h1>
        <p>
          Define the stages you actually use. Messages load only when selected, and no email is
          sent without exact-content approval.
        </p>
        <div className="job-setup-promise">
          <Database aria-hidden="true" />
          <span>
            <strong>Local SQLite vault</strong>
            <small>Application records persist on this device.</small>
          </span>
        </div>
        <div className="job-setup-promise">
          <LockKeyhole aria-hidden="true" />
          <span>
            <strong>Deliberate provider actions</strong>
            <small>Credentials stay encrypted and sending remains fail-closed.</small>
          </span>
        </div>
      </section>

      <form className="job-setup-form" onSubmit={submit}>
        <header>
          <p className="eyebrow">Workspace profile</p>
          <h2>Your application workflow</h2>
          <p>Stage order defines the initial forward transitions. Terminal stages have no exit.</p>
        </header>

        <div className="form-grid form-grid--two">
          <TextField
            label="Your name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoFocus
            required
          />
          <TextField
            label="Primary email"
            type="email"
            value={primaryEmail}
            onChange={(event) => setPrimaryEmail(event.target.value)}
            required
          />
        </div>

        <fieldset className="job-stage-builder">
          <legend>Application stages</legend>
          <p>Enter at least two unique stages in lifecycle order.</p>
          {stages.map((stage, index) => (
            <div className="job-stage-row" key={stage.key}>
              <span className="job-stage-position" aria-hidden="true">
                {index + 1}
              </span>
              <TextField
                label={`Stage ${index + 1} name`}
                value={stage.name}
                onChange={(event) => updateStage(stage.key, { name: event.target.value })}
                required
              />
              <label className="job-stage-terminal">
                <input
                  type="checkbox"
                  checked={stage.terminal}
                  onChange={(event) => updateStage(stage.key, { terminal: event.target.checked })}
                />
                Terminal
              </label>
              <Button
                type="button"
                tone="quiet"
                size="small"
                disabled={stages.length <= 2}
                onClick={() => setStages((current) => current.filter((item) => item.key !== stage.key))}
                aria-label={`Remove stage ${index + 1}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            tone="quiet"
            disabled={stages.length >= 32}
            onClick={() => {
              setStages((current) => [...current, { key: nextKey, name: '', terminal: false }]);
              setNextKey((current) => current + 1);
            }}
          >
            <Plus aria-hidden="true" /> Add stage
          </Button>
        </fieldset>

        <Button type="submit" tone="primary" loading={saving} disabled={!valid}>
          Create local workspace
        </Button>
      </form>
    </main>
  );
}

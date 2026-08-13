import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/src/App';
import { isSecureExternalUrl } from '../../src/renderer/src/lib/external-links';
import { HashRouter } from '../../src/renderer/src/lib/router';
import { WorkspaceProvider } from '../../src/renderer/src/state/WorkspaceContext';
import { bootstrapFixture, installBridge } from './fixtures';

function renderApplication(route = '#/applications'): void {
  window.location.hash = route;
  render(
    <HashRouter>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </HashRouter>,
  );
}

describe('job workspace production UX boundaries', () => {
  it('only treats credential-free HTTPS destinations as safe external links', () => {
    expect(isSecureExternalUrl('https://example.com/path?q=1')).toBe(true);
    expect(isSecureExternalUrl('https://user:pass@example.com/private')).toBe(false);
    expect(isSecureExternalUrl('http://example.com')).toBe(false);
    expect(isSecureExternalUrl('mailto:applicant@example.com')).toBe(false);
    expect(isSecureExternalUrl('not a URL')).toBe(false);
  });

  it('focuses the main landmark and updates the title after job navigation', async () => {
    installBridge(bootstrapFixture());
    renderApplication('#/inbox');
    const applicationsLink = await screen.findByRole('link', { name: 'Applications' });

    fireEvent.click(applicationsLink);

    expect(await screen.findByRole('heading', { name: 'Job Applications' })).toBeVisible();
    await waitFor(() => expect(document.querySelector('#main-content')).toHaveFocus());
    expect(document.title).toBe('Applications · Outreachr Job Applications');
  });
});

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthBadge } from './HealthBadge';
import { renderWithProviders, stubHealth } from '../test/utils';

describe('HealthBadge', () => {
  it('shows a checking state first', () => {
    stubHealth(true);
    renderWithProviders(<HealthBadge />);
    expect(screen.getByRole('status')).toHaveTextContent(/checking/i);
  });

  it('shows online with the version when the API is healthy', async () => {
    stubHealth(true);
    renderWithProviders(<HealthBadge />);
    expect(await screen.findByText(/API online/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0.1.0');
  });

  it('shows unavailable when the request fails', async () => {
    stubHealth(false);
    renderWithProviders(<HealthBadge />);
    expect(await screen.findByText(/API unavailable/i)).toBeInTheDocument();
  });

  it('shows unavailable when the API reports degraded (503)', async () => {
    const fetchMock = stubHealth(true);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'degraded', db: 'down' }), { status: 503 }),
    );
    renderWithProviders(<HealthBadge />);
    expect(await screen.findByText(/API unavailable/i)).toBeInTheDocument();
  });
});

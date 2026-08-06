import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TruncatedListNotice } from '~/components/common/TruncatedListNotice';

describe('TruncatedListNotice (#1208)', () => {
  it('renders nothing when the list is complete', () => {
    const { container } = render(<TruncatedListNotice shown={5} total={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the shown count somehow exceeds the total', () => {
    const { container } = render(<TruncatedListNotice shown={7} total={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('discloses the gap when more exist than are shown', () => {
    render(<TruncatedListNotice shown={200} total={4312} />);
    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent(
      'Showing 200 of 4,312 courses',
    );
  });

  it('appends the action hint when given', () => {
    render(<TruncatedListNotice shown={2} total={9} action="search to find the rest" />);
    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent(
      'Showing 2 of 9 courses — search to find the rest',
    );
  });

  it('accepts a custom noun', () => {
    render(<TruncatedListNotice shown={1} total={3} noun="activities" />);
    expect(screen.getByTestId('truncated-list-notice')).toHaveTextContent('of 3 activities');
  });

  it('renders nothing for a non-finite total (loader still resolving)', () => {
    const { container } = render(
      <TruncatedListNotice shown={2} total={undefined as unknown as number} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

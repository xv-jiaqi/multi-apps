import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ART_ASPECT, ART_EDGE, Artwork, useArtImage } from './artwork';
import { rootStore } from '../stores/root-store';

rootStore.locale.setLocale('zh-CN');

describe('Artwork', () => {
  it('renders a card image with the fixed card ratio, neutral surface, and alt text', () => {
    const { container } = render(
      <Artwork
        kind="card"
        src="https://img.cardhub.test/aurora.webp"
        slug="aurora-knight"
        name="Aurora Knight"
        fit="contain"
        priority
        placeholderInitial="bottom-left"
        className={`rounded-3xl ${ART_EDGE}`}
      />,
    );

    const frame = container.firstElementChild;
    expect(frame).toHaveClass(ART_ASPECT.card);
    expect(frame).toHaveClass('bg-neutral-100');
    expect(frame).toHaveClass('rounded-3xl');
    expect(frame).toHaveClass('ring-1');

    const image = screen.getByAltText('Aurora Knight 的卡面');
    expect(image).toHaveAttribute('src', 'https://img.cardhub.test/aurora.webp');
    expect(image).toHaveAttribute('loading', 'eager');
    expect(image).toHaveClass('object-contain');
  });

  it('uses decorative alt text for linked tiles and thumbs', () => {
    const { container } = render(
      <Artwork
        kind="card"
        src="https://img.cardhub.test/thumb.webp"
        slug="aurora-knight"
        name="Aurora Knight"
        decorative
        className="w-10 rounded-sm"
      />,
    );

    const image = container.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(container.firstElementChild).toHaveClass('w-10');
    expect(container.firstElementChild).toHaveClass(ART_ASPECT.card);
  });

  it('falls back to the existing gradient and initial when an image fails', () => {
    const { container } = render(
      <Artwork
        kind="card"
        src="https://img.cardhub.test/broken.webp"
        slug="aurora-knight"
        name="Aurora Knight"
        placeholderInitial="bottom-left"
      />,
    );

    const image = screen.getByAltText('Aurora Knight 的卡面');
    fireEvent.error(image);

    expect(screen.queryByAltText('Aurora Knight 的卡面')).not.toBeInTheDocument();
    expect(container.querySelector('.from-sky-200')).toBeInTheDocument();
    expect(container).toHaveTextContent('A');
  });

  it('uses the series ratio and no initial for series placeholders', () => {
    const { container } = render(
      <Artwork
        kind="series"
        src="gradient:from-sky-400-via-indigo-400-to-purple-500"
        slug="celestial-dawn"
        name="Celestial Dawn"
        decorative
      />,
    );

    expect(container.firstElementChild).toHaveClass(ART_ASPECT.series);
    expect(container.querySelector('.from-sky-400')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('C');
  });
});

function ModeProbe({ src }: { src: string }) {
  const art = useArtImage({ src, alt: 'probe', fit: 'cover' });
  return (
    <div>
      <span data-testid="mode">{art.mode}</span>
      {art.mode === 'image' ? <img key={src} {...art.imgProps} /> : null}
    </div>
  );
}

describe('useArtImage', () => {
  it('switches from image mode to placeholder mode after onError', () => {
    render(<ModeProbe src="https://img.cardhub.test/broken.webp" />);

    expect(screen.getByTestId('mode')).toHaveTextContent('image');
    fireEvent.error(screen.getByAltText('probe'));

    expect(screen.getByTestId('mode')).toHaveTextContent('placeholder');
  });

  it('starts in placeholder mode for http URLs', () => {
    render(<ModeProbe src="http://img.cardhub.test/card.webp" />);

    expect(screen.getByTestId('mode')).toHaveTextContent('placeholder');
  });

  it('resets loaded state when the image URL changes', () => {
    const { rerender } = render(<ModeProbe src="https://img.cardhub.test/one.webp" />);

    const firstImage = screen.getByAltText('probe');
    fireEvent.load(firstImage);
    expect(firstImage).toHaveAttribute('data-loaded', 'true');

    rerender(<ModeProbe src="https://img.cardhub.test/two.webp" />);

    const nextImage = screen.getByAltText('probe');
    expect(screen.getByTestId('mode')).toHaveTextContent('image');
    expect(nextImage).not.toHaveAttribute('data-loaded');
  });
});

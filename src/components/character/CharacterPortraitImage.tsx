import React from 'react';
import { User } from 'lucide-react';
import type { PortraitCrop } from '../../shared/types.ts';
import { getPortraitImageStyle } from '../../shared/utils.ts';

interface CharacterPortraitImageProps {
  src?: string | null;
  alt: string;
  crop?: PortraitCrop | null;
  className?: string;
  iconClassName?: string;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  loading?: 'eager' | 'lazy';
  onError?: () => void;
}

/**
 * Renders a character portrait thumbnail with optional non-destructive focal point + zoom styling,
 * falling back cleanly to a generic User icon when no portrait URL is available.
 */
export const CharacterPortraitImage: React.FC<CharacterPortraitImageProps> = ({
  src,
  alt,
  crop,
  className = 'w-full h-full object-cover',
  iconClassName = 'w-8 h-8 text-zinc-600',
  referrerPolicy,
  loading,
  onError,
}) => {
  if (!src) {
    return <User className={iconClassName} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={getPortraitImageStyle(crop)}
      referrerPolicy={referrerPolicy}
      loading={loading}
      onError={onError}
    />
  );
};

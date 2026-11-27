import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  RefreshCw,
  Shield,
  Sparkles,
  User,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type { CharacterProfile } from '../../shared/types.ts';
import type { CivitaiUserProfileResponse } from '../../shared/apiTypes.ts';
import { CivitaiEligibleCharactersGallery } from './CivitaiEligibleCharactersGallery.tsx';

interface CivitaiSettingsSectionProps {
  characters: CharacterProfile[];
  onOpenCharacter: (characterId: number) => void;
  onOpenCharactersTab: () => void;
  saveCivitaiImportImages: boolean;
  allowCivitaiShareUncharacterized: boolean;
  civitaiActivityNotificationsEnabled: boolean;
  insertCivitaiMetadataOnExport: boolean;
  uploadedImagesDir?: string;
  onToggleSaveCivitaiImportImages: (enabled: boolean) => Promise<void>;
  onToggleAllowCivitaiShareUncharacterized: (enabled: boolean) => Promise<void>;
  onToggleCivitaiActivityNotifications: (enabled: boolean) => Promise<void>;
  onToggleInsertCivitaiMetadataOnExport: (enabled: boolean) => Promise<void>;
}

function formatCompactCount(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return val.toLocaleString();
}

function formatJoinDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatLinkLabel(url: string, type: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return type && type.toLowerCase() !== 'website' ? `${type} · ${host}` : host;
  } catch {
    return type || url;
  }
}

/**
 * Dedicated Settings -> Civitai tab displaying the connected Civitai user profile card
 * (identity, membership tier, badges, bio, links, creator stats) and Civitai preferences.
 */
export const CivitaiSettingsSection: React.FC<CivitaiSettingsSectionProps> = ({
  characters,
  onOpenCharacter,
  onOpenCharactersTab,
  saveCivitaiImportImages,
  allowCivitaiShareUncharacterized,
  civitaiActivityNotificationsEnabled,
  insertCivitaiMetadataOnExport,
  uploadedImagesDir = 'data/uploaded',
  onToggleSaveCivitaiImportImages,
  onToggleAllowCivitaiShareUncharacterized,
  onToggleCivitaiActivityNotifications,
  onToggleInsertCivitaiMetadataOnExport,
}) => {
  const [profile, setProfile] = useState<CivitaiUserProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState<boolean>(false);
  const [coverFailed, setCoverFailed] = useState<boolean>(false);

  const loadProfile = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      const data = await api.getCivitaiUserProfile({ refresh: forceRefresh });
      setProfile(data);
      setAvatarFailed(false);
      setCoverFailed(false);
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load Civitai profile.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile(false);
  }, [loadProfile]);

  const statItems = profile
    ? [
        { label: 'Models Uploaded', value: profile.stats.uploadCount },
        { label: 'Followers', value: profile.stats.followerCount },
        { label: 'Following', value: profile.stats.followingCount },
        { label: 'Downloads', value: profile.stats.downloadCount },
        { label: 'Reactions', value: profile.stats.thumbsUpCount },
        { label: 'Generations', value: profile.stats.generationCount },
        { label: 'Buzz Tipped', value: profile.stats.tippedAmountCount },
        {
          label: profile.stats.leaderboardId ? `Rank (${profile.stats.leaderboardId})` : 'Rank',
          value: profile.stats.leaderboardPosition,
          prefix: '#',
        },
      ].filter((item): item is { label: string; value: number; prefix?: string } => item.value !== null)
    : [];

  const joinedLabel = formatJoinDate(profile?.createdAt ?? null);
  const displayName = profile?.username || 'Civitai Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="space-y-5">
      {/* Civitai User Profile Card */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {/* Optional Cover Banner */}
        {profile?.coverImageUrl && !coverFailed && (
          <div className="relative h-28 w-full bg-zinc-950 overflow-hidden">
            <img
              src={profile.coverImageUrl}
              alt="Civitai profile banner"
              referrerPolicy="no-referrer"
              onError={() => setCoverFailed(true)}
              className="w-full h-full object-cover opacity-75"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/35 to-transparent" />
          </div>
        )}

        <div className="p-5 space-y-5">
          {isLoading && !profile ? (
            <div className="flex items-center justify-center gap-2.5 py-10 text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Loading Civitai profile…</span>
            </div>
          ) : loadError && !profile ? (
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{loadError}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadProfile(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : profile ? (
            <>
              {/* Identity Header Row */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  {profile.avatarUrl && !avatarFailed ? (
                    <img
                      src={profile.avatarUrl}
                      alt={displayName}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                      className="w-16 h-16 rounded-2xl object-cover border-2 border-zinc-800 bg-zinc-950 shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl border-2 border-zinc-800 bg-zinc-950 flex items-center justify-center text-zinc-300 font-display font-semibold text-lg shrink-0">
                      {profile.username ? initials : <User className="w-7 h-7 text-zinc-500" />}
                    </div>
                  )}

                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2
                        className="text-base font-display font-semibold text-zinc-100 truncate"
                        style={profile.nameplate?.color ? { color: profile.nameplate.color } : undefined}
                      >
                        {displayName}
                      </h2>

                      {profile.userId !== null && (
                        <span className="px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-400">
                          #{profile.userId}
                        </span>
                      )}

                      {profile.tier && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/35 text-indigo-200 font-medium capitalize text-[11px]">
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>{profile.tier}</span>
                        </span>
                      )}

                      {profile.connected ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px]">
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>{profile.status ? profile.status : 'API Connected'}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[11px]">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Offline / Unreachable</span>
                        </span>
                      )}

                      {profile.isModerator && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/35 text-sky-300 text-[11px]">
                          <Shield className="w-3 h-3 shrink-0" />
                          <span>Moderator</span>
                        </span>
                      )}

                      {profile.muted && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/35 text-rose-300 text-[11px]">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Muted</span>
                        </span>
                      )}

                      {profile.isOnboarded === false && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-amber-200 text-[11px]">
                          <span>Onboarding Incomplete</span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                      {joinedLabel && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-zinc-500" />
                          <span>Joined {joinedLabel}</span>
                        </span>
                      )}
                      {profile.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-zinc-500" />
                          <span>{profile.location}</span>
                        </span>
                      )}
                      {profile.subscriptions.length > 0 && (
                        <span className="capitalize">
                          Plan: {profile.subscriptions.join(', ')}
                        </span>
                      )}
                      <span className="text-zinc-500">
                        Synced {new Date(profile.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isRefreshing}
                    onClick={() => void loadProfile(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 font-medium cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    <span>{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
                  </button>

                  {profile.profileUrl && (
                    <a
                      href={profile.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                    >
                      <span>Edit on Civitai</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  <a
                    href={profile.accountSettingsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100 font-medium"
                  >
                    <span>Account</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {profile.error && (
                <div className="px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{profile.error}</span>
                </div>
              )}

              {/* Bio */}
              {profile.bio && (
                <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line bg-zinc-950/70 border border-zinc-800/80 rounded-lg px-3.5 py-2.5">
                  {profile.bio}
                </p>
              )}

              {/* Equipped Badges */}
              {profile.badges.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                    <Award className="w-3.5 h-3.5 text-amber-400" />
                    <span>Equipped Badges ({profile.badges.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {profile.badges.map((badge) => (
                      <div
                        key={String(badge.id)}
                        title={badge.description || badge.name}
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800/90 text-zinc-200"
                      >
                        {badge.imageUrl ? (
                          <img
                            src={badge.imageUrl}
                            alt={badge.name}
                            referrerPolicy="no-referrer"
                            className="w-6 h-6 object-contain shrink-0"
                          />
                        ) : (
                          <Award className="w-4 h-4 text-amber-400 shrink-0" />
                        )}
                        <span className="text-xs font-medium">{badge.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Social Links */}
              {profile.links.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {profile.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-[11px] text-zinc-300 hover:text-zinc-100"
                    >
                      <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
                      <span>{formatLinkLabel(link.url, link.type)}</span>
                      <ExternalLink className="w-3 h-3 text-zinc-500 shrink-0" />
                    </a>
                  ))}
                </div>
              )}

              {/* Civitai Creator Stats Grid */}
              {statItems.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {statItems.map((stat) => (
                    <div
                      key={stat.label}
                      className="bg-zinc-950 border border-zinc-800/80 rounded-lg px-3 py-2"
                    >
                      <div className="text-[11px] text-zinc-400">{stat.label}</div>
                      <div className="text-sm font-display font-semibold text-zinc-100 mt-0.5">
                        {stat.prefix || ''}
                        {stat.prefix === '#' ? stat.value.toLocaleString() : formatCompactCount(stat.value)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Couchy Sharing & Local Integration Summary */}
              <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] text-zinc-400">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    CivitAI-Eligible Characters:{' '}
                    <strong className="text-zinc-200 font-medium">
                      {profile.couchySummary.eligibleCharacterCount} /{' '}
                      {profile.couchySummary.totalCharacterCount}
                    </strong>
                  </span>
                  <span>
                    Drafts:{' '}
                    <strong className="text-zinc-200 font-medium">
                      {profile.couchySummary.sharedDraftCount}
                    </strong>
                  </span>
                  <span>
                    Published Posts:{' '}
                    <strong className="text-zinc-200 font-medium">
                      {profile.couchySummary.publishedPostCount}
                    </strong>
                  </span>
                  <span>
                    Own Linked Models:{' '}
                    <strong className="text-zinc-200 font-medium">
                      {profile.couchySummary.ownUploadedModelsCount}
                    </strong>
                  </span>
                </div>
                <span className="text-zinc-500">
                  Bio, links, avatar, and badges are edited on Civitai; click Refresh to sync updates.
                </span>
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* CivitAI-Eligible Characters Portrait Gallery */}
      <CivitaiEligibleCharactersGallery
        characters={characters}
        eligibleCharacterStats={profile?.eligibleCharacterStats ?? []}
        onOpenCharacter={onOpenCharacter}
        onOpenCharactersTab={onOpenCharactersTab}
      />

      {/* Consolidated Civitai Workspace Preferences */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-display font-semibold text-zinc-100">
            Civitai Integration Preferences
          </h3>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Control Civitai image imports, draft sharing rules, activity alerts, and export metadata.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <h4 className="text-xs font-display font-semibold text-zinc-100">
                Save Civitai Import Images (1MP)
              </h4>
              <p
                className="text-[11px] text-zinc-400 leading-snug truncate"
                title={`Save 1MP copy of Civitai URL photos into ${uploadedImagesDir} as stack #1`}
              >
                Save 1MP Civitai URL photos to{' '}
                <code className="font-mono text-zinc-200">{uploadedImagesDir}</code> as stack #1.
              </p>
            </div>
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
              <span className="text-[11px] text-zinc-300 font-medium">
                {saveCivitaiImportImages ? 'On' : 'Off'}
              </span>
              <input
                type="checkbox"
                checked={saveCivitaiImportImages}
                onChange={(e) => onToggleSaveCivitaiImportImages(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
            </label>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <h4 className="text-xs font-display font-semibold text-zinc-100">
                Share 0-Character Images (Civitai)
              </h4>
              <p
                className="text-[11px] text-zinc-400 leading-snug truncate"
                title="When On, images with zero linked characters may be shared as Civitai drafts (Off by default)"
              >
                Allow Civitai draft sharing when an image has no linked character.
              </p>
            </div>
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
              <span className="text-[11px] text-zinc-300 font-medium">
                {allowCivitaiShareUncharacterized ? 'On' : 'Off'}
              </span>
              <input
                type="checkbox"
                checked={allowCivitaiShareUncharacterized}
                onChange={(e) => onToggleAllowCivitaiShareUncharacterized(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
            </label>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <h4 className="text-xs font-display font-semibold text-zinc-100">
                Civitai Activity Notifications
              </h4>
              <p
                className="text-[11px] text-zinc-400 leading-snug truncate"
                title="Show header alerts and gallery card counters for Civitai reactions & comments"
              >
                Show header alerts and gallery card counters for Civitai reactions &amp; comments.
              </p>
            </div>
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
              <span className="text-[11px] text-zinc-300 font-medium">
                {civitaiActivityNotificationsEnabled ? 'On' : 'Off'}
              </span>
              <input
                type="checkbox"
                checked={civitaiActivityNotificationsEnabled}
                onChange={(e) => onToggleCivitaiActivityNotifications(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
            </label>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <h4 className="text-xs font-display font-semibold text-zinc-100">
                Insert Civitai Metadata on Export
              </h4>
              <p
                className="text-[11px] text-zinc-400 leading-snug truncate"
                title="Embed Civitai/A1111 parameters, resource IDs & LoRA hashes on download/ZIP"
              >
                Embed Civitai/A1111 parameters, resource IDs &amp; LoRA hashes on download/ZIP.
              </p>
            </div>
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
              <span className="text-[11px] text-zinc-300 font-medium">
                {insertCivitaiMetadataOnExport ? 'On' : 'Off'}
              </span>
              <input
                type="checkbox"
                checked={insertCivitaiMetadataOnExport}
                onChange={(e) => onToggleInsertCivitaiMetadataOnExport(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
};

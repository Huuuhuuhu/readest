import { useRef, useState } from 'react';
import Dialog from '@/components/Dialog';
import NumberInput from '@/components/settings/NumberInput';
import { BoxedList } from '@/components/settings/primitives';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { saveViewSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { FONT_SIZE_STEP, MAX_FONT_SIZE, MIN_FONT_SIZE } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

export default function TVReadingMenu({
  bookKey,
  open,
  onClose,
  onLibrary,
}: {
  bookKey: string;
  open: boolean;
  onClose: () => void;
  onLibrary: () => void;
}) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const theme = useThemeStore((state) => state.themeMode);
  const [error, setError] = useState('');
  const saveQueue = useRef(Promise.resolve());
  const save = <K extends keyof ViewSettings>(key: K, value: ViewSettings[K]) => {
    // Serialize quick repeats so a slow disk write cannot overwrite the latest setting.
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(async () => {
        await saveViewSettings(envConfig, bookKey, key, value);
        setError('');
      })
      .catch(() => setError(_('Could not save settings')));
  };
  const openSidebar = (search: boolean) => {
    const sidebar = useSidebarStore.getState();
    const books = useBookDataStore.getState();
    const config = books.getConfig(bookKey);
    if (config?.viewSettings)
      books.setConfig(bookKey, { viewSettings: { ...config.viewSettings, sideBarTab: 'toc' } });
    onClose();
    sidebar.setSideBarBookKey(bookKey);
    sidebar.setSearchBarVisible(search);
    sidebar.setSideBarVisible(true);
  };
  const actionClass = 'btn btn-ghost w-full justify-start rounded-none px-4 text-start';
  return (
    <Dialog isOpen={open} title={_('Reading menu')} onClose={onClose}>
      <div className='settings-content mx-auto w-full max-w-2xl space-y-3 p-4'>
        <p>{_('Up/Down: choose · Left/Right: adjust · Back: read')}</p>
        <BoxedList>
          <button data-tv-initial-focus className={actionClass} onClick={() => openSidebar(false)}>
            {_('Table of Contents')}
          </button>
          <NumberInput
            label={_('Font Size')}
            value={viewSettings?.defaultFontSize ?? 16}
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={FONT_SIZE_STEP}
            onChange={(value) => save('defaultFontSize', value)}
          />
          <NumberInput
            label={_('Maximum Number of Columns')}
            value={viewSettings?.maxColumnCount ?? 2}
            min={1}
            max={4}
            onChange={(value) => save('maxColumnCount', value)}
          />
          <button
            className={actionClass}
            onClick={() =>
              useThemeStore.getState().setThemeMode(theme === 'dark' ? 'light' : 'dark')
            }
          >
            {_('Theme')}: {theme === 'dark' ? _('Dark') : _('Light')}
          </button>
          <button className={actionClass} onClick={() => save('scrolled', !viewSettings?.scrolled)}>
            {_('Scrolled Mode')}: {viewSettings?.scrolled ? _('On') : _('Off')}
          </button>
          <button
            className={actionClass}
            onClick={() => {
              void eventDispatcher.dispatch('toggle-bookmark', { bookKey });
            }}
          >
            {_('Toggle Bookmark')}
          </button>
          <button
            className={actionClass}
            onClick={() => {
              onClose();
              void eventDispatcher.dispatch('tts-toggle-play', { bookKey });
            }}
          >
            {_('Read Aloud')}
          </button>
          <button className={actionClass} onClick={() => openSidebar(true)}>
            {_('Search in Book')}
          </button>
          <button
            className={actionClass}
            onClick={() => {
              const settings = useSettingsStore.getState();
              settings.setSettingsDialogBookKey(bookKey);
              settings.setSettingsDialogOpen(true);
            }}
          >
            {_('More Settings')}
          </button>
          <button className={actionClass} onClick={onLibrary}>
            {_('Back to Library')}
          </button>
        </BoxedList>
        {error && <p role='status'>{error}</p>}
      </div>
    </Dialog>
  );
}

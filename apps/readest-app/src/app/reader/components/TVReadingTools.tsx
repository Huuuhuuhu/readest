import { useState } from 'react';
import Dialog from '@/components/Dialog';
import NumberInput from '@/components/settings/NumberInput';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import ViewMenu from './ViewMenu';
import TranslationToggler from './TranslationToggler';
import SyncInfoDialog from './SyncInfoDialog';

/** Reuse the existing reader actions, with a remote-owned dialog and explicit seek commit. */
export default function TVReadingTools({
  bookKey,
  onBack,
  onDone,
}: {
  bookKey: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const reader = useReaderStore.getState();
  const view = reader.getView(bookKey);
  const bookData = useBookDataStore.getState().getBookData(bookKey);
  const [progress, setProgress] = useState(
    Math.round((reader.getProgress(bookKey)?.fraction ?? 0) * 100),
  );
  const [syncInfo, setSyncInfo] = useState(false);
  return (
    <>
      <Dialog isOpen title='更多阅读工具' onClose={onBack}>
        <div className='settings-content mx-auto w-full max-w-2xl space-y-3 p-4'>
          <p>上下选择，左右调整。进度只在确认跳转后生效。</p>
          <NumberInput
            label='阅读进度 (%)'
            value={progress}
            min={0}
            max={100}
            onChange={setProgress}
          />
          <div className='flex flex-wrap gap-3'>
            <button
              className='btn btn-contrast'
              onClick={() => {
                view?.goToFraction(progress / 100);
                onDone();
              }}
            >
              确认跳转
            </button>
            <button
              className='btn'
              disabled={!view?.history.canGoBack}
              onClick={() => {
                view?.history.back();
                onDone();
              }}
            >
              返回上一阅读位置
            </button>
            <button
              className='btn'
              disabled={!view?.history.canGoForward}
              onClick={() => {
                view?.history.forward();
                onDone();
              }}
            >
              前进到下一阅读位置
            </button>
            <TranslationToggler bookKey={bookKey} />
          </div>
          <ViewMenu
            bookKey={bookKey}
            embedded
            setIsDropdownOpen={(value) => {
              if (!value) onDone();
            }}
            onShowMetaHashDialog={() => setSyncInfo(true)}
          />
        </div>
      </Dialog>
      {syncInfo && (
        <SyncInfoDialog
          isOpen
          bookKey={bookKey}
          metadata={bookData?.bookDoc?.metadata ?? bookData?.book?.metadata}
          storedMetaHash={bookData?.book?.metaHash}
          onClose={() => setSyncInfo(false)}
        />
      )}
    </>
  );
}

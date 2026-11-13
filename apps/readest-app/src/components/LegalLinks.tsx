import Link from './Link';
const LegalLinks = () => (
  <div className='my-2 flex flex-wrap justify-center gap-4 text-sm'>
    <Link href='https://github.com/Huuuhuuhu/readest/blob/tv/0.12.20/LICENSE' className='underline'>
      开源许可
    </Link>
    <Link
      href='https://github.com/Huuuhuuhu/readest/blob/tv/0.12.20/apps/readest-app/docs/android-tv-network.md'
      className='underline'
    >
      联网与隐私说明
    </Link>
  </div>
);
export default LegalLinks;

const retired = async (): Promise<never> => {
  throw new Error("Legacy mutable-document cloud sync is retired");
};

export const gdriveUploadSafe = retired;
export const gdriveUploadReplace = retired;
export const gdriveStartPollLoop = retired;
export const gdriveDownloadLatest = retired;
export const gdriveDeleteFile = retired;
export const dropboxUploadSafe = retired;
export const dropboxUploadReplace = retired;
export const dropboxStartLongpollLoop = retired;
export const dropboxDownloadLatest = retired;
export const dropboxDeleteFile = retired;

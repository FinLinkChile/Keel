import type { UploadResult } from './client';

// What the exporter screen says about an upload. Only the outcome: nothing here pays or changes
// the order, and the copy never suggests it does.
export type UploadStatus = {
  // Status word on the right of the document row, when the upload went through
  word?: 'Accepted' | 'Under review' | 'Already uploaded' | 'Uploaded';
  // Line under the document name when it did not, with what to do next
  problem?: string;
};

export function uploadStatus(result: UploadResult): UploadStatus {
  switch (result.kind) {
    case 'accepted':
      return { word: 'Accepted' };
    case 'under_review':
      return { word: 'Under review' };
    case 'duplicate':
      return { word: 'Already uploaded' };
    // Stored for reading; the outcome comes as a notice, not on this screen yet
    case 'sent':
      return { word: 'Uploaded' };
    case 'rejected':
      switch (result.reason) {
        case 'bad_signature':
        case 'stale_signature':
          return { problem: "Check the phone's date and time, then upload again" };
        case 'not_a_party':
          return { problem: "This wallet can't upload to this order" };
        case 'too_large':
          return { problem: 'File over 10 MB' };
        case 'unknown_order':
          return { problem: 'Keel does not know this order yet' };
        case 'unknown_doc_type':
        case 'invalid_request':
          return { problem: 'The upload could not be read, try again' };
      }
      break;
    case 'failed':
      switch (result.reason) {
        case 'not_configured':
          return { problem: 'Uploads are not set up in this app' };
        case 'network':
          return { problem: "Couldn't reach Keel, check the connection" };
        case 'server':
          return { problem: 'Something went wrong on our side, try again' };
      }
  }
}

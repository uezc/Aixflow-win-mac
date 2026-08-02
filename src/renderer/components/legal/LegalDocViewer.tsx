import React from 'react';
import { getLegalDocMarkdown, type LegalDocId } from '../../legal/legalDocs';
import { SimpleMarkdown } from './SimpleMarkdown';

type Props = {
  docId: LegalDocId;
  className?: string;
};

/** 可滚动协议正文；正文来自 /docs/legal/*.md。 */
export const LegalDocViewer: React.FC<Props> = ({ docId, className = '' }) => {
  const md = getLegalDocMarkdown(docId);
  return (
    <div className={`custom-scrollbar max-h-[min(70vh,560px)] overflow-y-auto pr-1 ${className}`}>
      <SimpleMarkdown markdown={md} />
    </div>
  );
};

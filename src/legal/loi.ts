/** Bump this when the letter text changes. Stored on every acceptance. */
export const LOI_VERSION = '2026-11-08';

export const LOI_TITLE = 'Rukmer Customer Letter of Intent';

export type LoiBlock = { heading?: string; paragraphs: string[] };

export const LOI_BLOCKS: LoiBlock[] = [
  {
    paragraphs: [
      'Effective Date: [Date of acceptance]',
      'Parties:',
      'Rukmer Inc. (“Rukmer,” “we,” “us”), located at 25 N New Jersey St, Indianapolis, IN 46204',
      'The individual or organization creating the account (“Customer,” “you”)',
    ],
  },
  {
    heading: '1. Purpose and Intent',
    paragraphs: [
      'Customer intends to use Rukmer as a centralized memory and intelligence layer for its AI agents and tools (the “Service”).',
      'Customer intends to connect existing systems (including but not limited to email, chat, documents, and other business tools) so that Rukmer can capture, structure, and deliver organizational knowledge, decisions, context, and institutional memory (the “Company Brain”) to Customer’s authorized AI agents and users.',
      'By accepting this Letter of Intent, Customer confirms this intent and authorizes Rukmer to process the necessary data solely to deliver the Service.',
    ],
  },
  {
    heading: '2. Nature of This Letter',
    paragraphs: [
      'This Letter of Intent becomes binding upon acceptance at signup for the limited purposes set out below (data access rights, confidentiality, ownership, and restrictions).',
      'Broader commercial terms (pricing, SLAs, support levels, termination rights beyond what is stated here) are governed by Rukmer’s full Terms of Service and any applicable order form or enterprise agreement, which are incorporated by reference. Where there is a conflict, the full Terms control for commercial matters; this Letter controls for data, ownership, and confidentiality of the Company Brain.',
    ],
  },
  {
    heading: '3. Ownership of Data and the Company Brain',
    paragraphs: [
      'Customer retains full ownership of all data it or its users provide or that is accessed from Customer’s connected systems (“Customer Data”), and of all derived memory, embeddings, indexes, structured knowledge, and the Company Brain created from that data.',
      'Rukmer acquires no ownership rights in Customer Data or the Company Brain. Rukmer is granted only a limited, non-exclusive, revocable license to process Customer Data solely to provide, maintain, and improve the Service for Customer.',
    ],
  },
  {
    heading: '4. No Training on Customer Data',
    paragraphs: [
      'Rukmer will not use Customer Data or the Company Brain to train, fine-tune, or improve general-purpose or multi-tenant AI models that are used for other customers or made available outside of Customer’s account, except as Customer explicitly opts in in writing.',
      'Processing to deliver the Service (including creating Customer-specific memory, retrieval indexes, and context for Customer’s agents) is permitted.',
    ],
  },
  {
    heading: '5. Authorization to Access Connected Systems',
    paragraphs: [
      'Customer represents that it has the authority to connect the systems and grant Rukmer access to the data necessary to build and maintain the Company Brain. Customer authorizes Rukmer to access, read, index, and process that data solely for the purpose of providing the Service to Customer.',
    ],
  },
  {
    heading: '6. Confidentiality',
    paragraphs: [
      'Each party will protect the other’s confidential information with at least the same care it uses for its own, and not less than reasonable care. Customer Data and the Company Brain are Customer’s confidential information. Rukmer’s non-public technology, models, and pricing are Rukmer’s confidential information.',
    ],
  },
  {
    heading: '7. Security and Privacy',
    paragraphs: [
      'Rukmer will implement reasonable technical and organizational measures to protect Customer Data. Rukmer’s Privacy Policy and any applicable Data Processing Agreement are incorporated by reference and form part of this Letter.',
    ],
  },
  {
    heading: '8. Acceptable Use and Customer Responsibilities',
    paragraphs: [
      'Customer is responsible for the legality of the data it connects and for ensuring its use of the Service complies with applicable law and its own internal policies. Customer will not use the Service to process data it is not authorized to share.',
    ],
  },
  {
    heading: '9. Limitation of Liability (Binding)',
    paragraphs: [
      'To the maximum extent permitted by law, Rukmer’s total liability arising out of this Letter or the Service is limited to the amounts paid by Customer to Rukmer in the twelve (12) months preceding the claim (or $100 if no fees have been paid). Neither party is liable for indirect, incidental, special, consequential, or punitive damages.',
    ],
  },
  {
    heading: '10. Acceptance',
    paragraphs: [
      'By creating an account, checking the acceptance box, or otherwise indicating agreement during signup, Customer accepts this Letter of Intent on behalf of itself and its organization and agrees to be bound by its terms.',
    ],
  },
];

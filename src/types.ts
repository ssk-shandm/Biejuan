export type ContentFormat = 'text' | 'txt' | 'markdown' | 'mermaid' | 'plantuml'

/** 推荐在题库 JSON 中使用的稳定题型标识。旧中文题型仍由加载器兼容。 */
export type CanonicalQuestionType =
  | 'single'
  | 'multiple'
  | 'true-false'
  | 'fill'
  | 'short-answer'
  | 'program-analysis'
  | 'code'
  | 'compound'

export type QuestionType =
  | '单选题'
  | '多选题'
  | '判断题'
  | '填空题'
  | '简答题'
  | '程序分析题'
  | '编程题'
  | '综合题'
  | '综合应用题'

export interface AnswerDetail {
  /** 所有可接受答案；比较时忽略首尾空格和大小写。 */
  accepts: string[]
}

/** 外部 JSON 中的子题结构。content 是推荐字段，question 用于兼容旧题库。 */
export interface SubQuestionSource {
  id?: number
  type?: CanonicalQuestionType | QuestionType | '文本题' | string
  content?: string
  question?: string
  format?: ContentFormat
  options?: Record<string, string>
  answer?: string | string[] | number | boolean
  answerDetail?: AnswerDetail
  answerFormat?: ContentFormat
  codeLanguage?: string
}

/** 外部 JSON 的统一题目结构；加载后会被规范化为 Question。 */
export interface QuestionSource {
  id?: string
  number?: number
  type?: CanonicalQuestionType | QuestionType | string
  content?: string
  /** @deprecated 请使用 content。 */
  question?: string
  /** 同时控制题干、场景、答案和解析的默认渲染格式。 */
  format?: ContentFormat
  options?: Record<string, string>
  answer?: string | string[] | number | boolean
  explanation?: string
  /** 错题模式下展示的错因、易错点或复习提示。 */
  wrongDescription?: string
  answerDetail?: AnswerDetail
  images?: string[]
  scenario?: string
  subQuestions?: SubQuestionSource[]
  /** 以下字段仅用于兼容旧题库，可逐步迁移到 format。 */
  answerFormat?: ContentFormat
  scenarioFormat?: ContentFormat
  explanationFormat?: ContentFormat
  codeLanguage?: string
}

/** 应用内部使用的、字段完整且已规范化的子题。 */
export interface SubQuestion {
  id: number
  question: string
  type: '单选题' | '多选题' | '填空题' | '文本题'
  format: ContentFormat
  options: Record<string, string>
  answer: string
  answerDetail?: AnswerDetail
  answerFormat: ContentFormat
  codeLanguage?: string
}

/** 复合题单道子题的作答记录。 */
export interface SubAnswer {
  userAnswer: string
  isCorrect: boolean | null
}

/** 应用内部使用的规范化题目。 */
export interface Question {
  id?: string
  number: number
  type: QuestionType
  question: string
  format: ContentFormat
  options: Record<string, string>
  answer: string
  explanation: string
  wrongDescription: string
  answerDetail?: AnswerDetail
  images: string[]
  answerFormat: ContentFormat
  explanationFormat: ContentFormat
  codeLanguage?: string
  scenario?: string
  scenarioFormat: ContentFormat
  subQuestions?: SubQuestion[]
}

export type UserAnswer = string | string[] | null

export type AppMode = 'start' | 'practice' | 'endorse' | 'exam' | 'review' | 'wrong' | 'wrong-manage' | 'specialize' | 'settings' | 'about'

/** 错题本中的一条记录（允许重复，按添加时间排序）。 */
export interface WrongQuestionEntry {
  id: number
  questionNumber: number
  bankFile: string
  addedAt: number
  notebookId?: string
}

/** 错题本（可创建多个）。 */
export interface WrongNotebook {
  id: string
  name: string
  bankFile: string
  createdAt: number
}

from typing import Literal
from pydantic import BaseModel, Field, ConfigDict

class Citation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    document_id: str
    clause_id: str
    quote: str = Field(min_length=3, max_length=4000)

class Finding(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=3, max_length=240)
    category: Literal['нарушение', 'на согласование', 'допустимо', 'нужны данные']
    explanation: str = Field(min_length=5, max_length=4000)
    contract: Citation
    evidence: list[Citation] = Field(max_length=8)
    suggestion: str = Field(default='', max_length=3000)
    decision: Literal['pending', 'accepted', 'rejected'] = 'pending'

class ReviewResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    summary: str = Field(min_length=3, max_length=5000)
    findings: list[Finding] = Field(max_length=200)
    reviewed_clause_ids: list[str]
    limitations: list[str] = Field(max_length=100)

class Decisions(BaseModel):
    revision: int
    findings: list[Finding]
    lawyer_note: str = Field(default='', max_length=5000)

class StartReview(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    contract_id: str
    template_id: str
    policy_id: str
    specification_id: str | None = None
    supplier_id: str | None = None
    model: str = Field(default='', max_length=120)
    mode: Literal['gigachat', 'demo'] = 'gigachat'
    max_steps: int = Field(default=18, ge=2, le=40)
    max_tokens: int = Field(default=65000, ge=5000, le=250000)

class Revision(BaseModel):
    revision: int

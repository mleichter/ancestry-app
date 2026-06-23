"""add sources to persons

Revision ID: b2c3d4e5f6a1
Revises: 7cad6041afa2
Create Date: 2026-06-23 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6a1'
down_revision: Union[str, None] = '7cad6041afa2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('persons', sa.Column('sources', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('persons', 'sources')

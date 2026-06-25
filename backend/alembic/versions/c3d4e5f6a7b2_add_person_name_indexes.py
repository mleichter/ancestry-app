"""add person name indexes

Revision ID: c3d4e5f6a7b2
Revises: b2c3d4e5f6a1
Create Date: 2026-06-25 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = 'c3d4e5f6a7b2'
down_revision: Union[str, None] = 'b2c3d4e5f6a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_persons_last_name', 'persons', ['last_name'])
    op.create_index('ix_persons_first_name', 'persons', ['first_name'])


def downgrade() -> None:
    op.drop_index('ix_persons_last_name', table_name='persons')
    op.drop_index('ix_persons_first_name', table_name='persons')

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.person import Person
from app.models.relationship import Relationship, RelationshipType
from app.schemas.tree import TreeNode, TreeEdge, TreeResponse


async def build_tree(db: AsyncSession) -> TreeResponse:
    persons_result = await db.execute(select(Person))
    persons = persons_result.scalars().all()

    rels_result = await db.execute(select(Relationship))
    rels = rels_result.scalars().all()

    nodes = [
        TreeNode(
            id=str(p.id),
            label=f"{p.first_name} {p.last_name}",
            gender=p.gender,
            date_of_birth=p.date_of_birth,
            date_of_death=p.date_of_death,
            is_living=p.is_living,
            avatar_media_id=p.avatar_media_id,
        )
        for p in persons
    ]

    edges = []
    for rel in rels:
        label = None
        if rel.type == RelationshipType.parent_child:
            label = "parent → child"
        elif rel.type == RelationshipType.partner:
            label = "partner"

        edges.append(
            TreeEdge(
                id=str(rel.id),
                source=str(rel.person_a_id),
                target=str(rel.person_b_id),
                type=rel.type.value,
                label=label,
            )
        )

    return TreeResponse(nodes=nodes, edges=edges)

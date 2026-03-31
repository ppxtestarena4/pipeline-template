import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] Seeding database...');

  // Create admin
  const adminHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@techtcb.local' },
    update: {},
    create: {
      email: 'admin@techtcb.local',
      passwordHash: adminHash,
      name: 'Администратор',
      role: 'ADMIN',
      type: 'HUMAN',
    },
  });

  // Create top-level manager (has his own boss = admin)
  const managerHash = await bcrypt.hash('manager123', 10);
  const manager = await prisma.user.upsert({
    where: { email: 'manager@techtcb.local' },
    update: {},
    create: {
      email: 'manager@techtcb.local',
      passwordHash: managerHash,
      name: 'Руководитель',
      role: 'MANAGER',
      type: 'HUMAN',
      managerId: admin.id,
    },
  });

  // Create direct reports
  const employees = [
    { name: 'Мельников', email: 'melnikov@techtcb.local' },
    { name: 'Анисимов', email: 'anisimov@techtcb.local' },
    { name: 'Ваня', email: 'vanya@techtcb.local' },
    { name: 'Лёша', email: 'lyosha@techtcb.local' },
    { name: 'Диана', email: 'diana@techtcb.local' },
    { name: 'Гаврилов', email: 'gavrilov@techtcb.local' },
  ];

  const employeeHash = await bcrypt.hash('employee123', 10);
  const createdEmployees: { id: string; name: string }[] = [];

  for (const emp of employees) {
    const user = await prisma.user.upsert({
      where: { email: emp.email },
      update: {},
      create: {
        email: emp.email,
        passwordHash: employeeHash,
        name: emp.name,
        role: 'EMPLOYEE',
        type: 'HUMAN',
        managerId: manager.id,
      },
    });
    createdEmployees.push(user);
  }

  // Create AI agents
  const coder = await prisma.user.upsert({
    where: { email: 'coder@agents.internal' },
    update: {},
    create: {
      email: 'coder@agents.internal',
      name: 'Claude Coder',
      role: 'AI_AGENT',
      type: 'AI_AGENT',
      apiToken: `agent_${uuidv4().replace(/-/g, '')}`,
      managerId: manager.id,
    },
  });

  // Create projects for each employee
  const projectData = [
    { name: 'МФО', owner: createdEmployees[0] },
    { name: 'Inside', owner: createdEmployees[1] },
    { name: 'Cashflow', owner: createdEmployees[2] },
  ];

  for (const pd of projectData) {
    const existing = await prisma.project.findFirst({ where: { name: pd.name } });
    if (existing) continue;

    const project = await prisma.project.create({
      data: {
        name: pd.name,
        description: `Проект ${pd.name}`,
        ownerId: pd.owner.id,
        members: {
          create: [
            { userId: pd.owner.id },
            { userId: manager.id },
          ],
        },
      },
    });

    // Add sample tasks
    await prisma.task.createMany({
      data: [
        {
          title: `Анализ портфеля ${pd.name}`,
          description: 'Провести детальный анализ текущего состояния',
          projectId: project.id,
          assigneeId: pd.owner.id,
          creatorId: manager.id,
          status: 'DONE',
          priority: 'HIGH',
          category: 'RUN',
          completedAt: new Date(),
          position: 1,
        },
        {
          title: `Миграция базы данных ${pd.name}`,
          description: 'Перенести данные на новую схему',
          projectId: project.id,
          assigneeId: pd.owner.id,
          creatorId: manager.id,
          status: 'IN_PROGRESS',
          priority: 'CRITICAL',
          category: 'CHANGE',
          position: 2,
        },
        {
          title: `Документация ${pd.name}`,
          description: 'Обновить техническую документацию',
          projectId: project.id,
          assigneeId: pd.owner.id,
          creatorId: pd.owner.id,
          status: 'TODO',
          priority: 'LOW',
          category: 'RUN',
          position: 3,
        },
      ],
    });
  }

  console.log('[seed] Done!');
  console.log('Credentials:');
  console.log('  Admin:    admin@techtcb.local / admin123');
  console.log('  Manager:  manager@techtcb.local / manager123');
  console.log('  Employee: melnikov@techtcb.local / employee123');
  console.log('  Agent token:', coder.apiToken);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
